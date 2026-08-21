import AsyncStorage from '@react-native-async-storage/async-storage';

// Stub the Firestore layer so background fetches / fire-and-forget writes never
// touch a real Firebase instance. Each test drives the fetch resolution itself.
jest.mock('@/services/firebaseService', () => ({
  saveGameToFirestore: jest.fn(() => Promise.resolve()),
  deleteGameFromFirestore: jest.fn(() => Promise.resolve()),
  fetchGamesFromFirestore: jest.fn(() => Promise.resolve([])),
  isFirestoreOfflineError: jest.fn(() => false),
}));

// syncService now imports deleteSharedGame. Mock the module so the test never
// reaches firebase/firestore — @/services/firebaseService is already stubbed
// above, so sharedGameService's `db` import would be undefined at runtime.
jest.mock('@/services/sharedGameService', () => ({
  deleteSharedGame: jest.fn(() => Promise.resolve()),
}));

import { Game } from '@/types/game';
import {
  SyncService,
  applyPendingMutations,
  withStorageLock,
  unionRecoverablePlayerFields,
} from '@/services/syncService';
import { StorageService } from '@/services/storageService';
import {
  fetchGamesFromFirestore,
  saveGameToFirestore,
  deleteGameFromFirestore,
} from '@/services/firebaseService';
import { deleteSharedGame } from '@/services/sharedGameService';

const UID = 'user1';

// Flush pending microtasks + the AsyncStorage macrotasks the background sync awaits.
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise(res => setTimeout(res, 0));
  }
};

function makeGame(players: { id: string; name: string }[]): Game {
  return {
    id: 'game1',
    name: 'Friday Night',
    date: new Date('2026-07-01T00:00:00Z'),
    status: 'active',
    players: players.map(p => ({ id: p.id, name: p.name })),
    transactions: [],
    createdAt: new Date('2026-07-01T00:00:00Z'),
    syncedAt: new Date('2026-07-01T00:00:00Z'),
  } as Game;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  SyncService.clearPendingMutations();
  (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([]);
  (saveGameToFirestore as jest.Mock).mockResolvedValue(undefined);
  (deleteGameFromFirestore as jest.Mock).mockResolvedValue(undefined);
  (deleteSharedGame as jest.Mock).mockResolvedValue(undefined);
});

describe('background-sync race: a local edit during the sync window survives (the bug)', () => {
  it('does not resurrect a player deleted after loadGames but before the background merge resolves', async () => {
    // Seed local storage with a game containing players A and X, already in sync.
    const gameWithX = makeGame([{ id: 'A', name: 'Alice' }, { id: 'X', name: 'Xavier' }]);
    await StorageService.saveGames([gameWithX]);

    // Hold the background Firestore fetch open so we can interleave a local delete
    // before it resolves — exactly the post-reload window the bug lives in.
    let resolveFetch!: (games: Game[]) => void;
    (fetchGamesFromFirestore as jest.Mock).mockReturnValue(
      new Promise<Game[]>(res => { resolveFetch = res; }),
    );

    const delivered: Game[][] = [];
    const local = await SyncService.loadGames(UID, merged => { delivered.push(merged); });

    // loadGames returns the pre-delete local snapshot immediately.
    expect(local[0].players.map(p => p.id)).toEqual(['A', 'X']);

    // User swipe-deletes player X (same path GameContext.updateGame takes).
    const afterDelete: Game = { ...gameWithX, players: gameWithX.players.filter(p => p.id !== 'X') };
    await SyncService.saveGame(UID, afterDelete);

    // NOW the in-flight background fetch resolves, returning the stale pre-delete
    // remote (still has X). It must not clobber the just-persisted deletion.
    resolveFetch([gameWithX]);
    await flush();

    // Storage must still reflect the deletion.
    const stored = await StorageService.loadGames();
    expect(stored[0].players.map(p => p.id)).not.toContain('X');
    expect(stored[0].players.map(p => p.id)).toEqual(['A']);

    // The UI update delivered via onRemoteUpdate must not bring X back either.
    const lastDelivered = delivered[delivered.length - 1];
    expect(lastDelivered).toBeDefined();
    expect(lastDelivered[0].players.map(p => p.id)).not.toContain('X');
  });
});

describe('applyPendingMutations (pure reconciliation)', () => {
  const g = (id: string, players: { id: string; name: string }[]) => {
    const base = makeGame(players);
    return { ...base, id } as Game;
  };

  it('forces the fresh-local version for a game with a pending save', () => {
    const localEdited = g('game1', [{ id: 'A', name: 'Alice' }]);            // B removed locally
    const mergedRemote = g('game1', [{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }]);
    const out = applyPendingMutations([mergedRemote], [localEdited], new Set(['game1']), new Set());
    expect(out).toHaveLength(1);
    expect(out[0].players.map(p => p.id)).toEqual(['A']);
  });

  it('re-adds a pending-saved game that the merge dropped entirely', () => {
    const localOnly = g('game1', [{ id: 'A', name: 'Alice' }]);
    const out = applyPendingMutations([], [localOnly], new Set(['game1']), new Set());
    expect(out.map(x => x.id)).toEqual(['game1']);
  });

  it('removes a game with a pending delete', () => {
    const remoteStillHasIt = g('game1', [{ id: 'A', name: 'Alice' }]);
    const out = applyPendingMutations([remoteStillHasIt], [], new Set(), new Set(['game1']));
    expect(out).toEqual([]);
  });

  it('leaves non-pending games untouched', () => {
    const other = g('game2', [{ id: 'C', name: 'Cara' }]);
    const out = applyPendingMutations([other], [], new Set(), new Set());
    expect(out).toEqual([other]);
  });

  it('removes a game that is in BOTH saves and deletes (delete wins)', () => {
    const local = g('game1', [{ id: 'A', name: 'Alice' }]);
    const out = applyPendingMutations([local], [local], new Set(['game1']), new Set(['game1']));
    expect(out).toEqual([]);
  });
});

describe('pending-mutations registry protects local edits (Limitation 1)', () => {
  it('keeps a local edit when a strictly-newer remote would otherwise revert it', async () => {
    const T1 = new Date('2026-07-01T00:00:00Z');
    const T2 = new Date('2026-07-02T00:00:00Z');
    const original = { ...makeGame([{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }]), syncedAt: T1 } as Game;
    await StorageService.saveGames([original]);

    // The local edit's Firestore write is still in flight when the merge runs.
    (saveGameToFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
    const edited = { ...original, players: [{ id: 'A', name: 'Alice' }] } as Game;   // B removed
    await SyncService.saveGame(UID, edited);

    let resolveFetch!: (games: Game[]) => void;
    (fetchGamesFromFirestore as jest.Mock).mockReturnValue(new Promise<Game[]>(res => { resolveFetch = res; }));
    const delivered: Game[][] = [];
    await SyncService.loadGames(UID, merged => { delivered.push(merged); });

    // Another device's newer state still has B (and a C) — must NOT clobber the local delete of B.
    resolveFetch([{ ...original, players: [{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }, { id: 'C', name: 'Cara' }], syncedAt: T2 } as Game]);
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].players.map(p => p.id)).toEqual(['A']);
    expect(delivered[delivered.length - 1][0].players.map(p => p.id)).toEqual(['A']);
  });

  it('releases protection once the Firestore write confirms (no permanent lock)', async () => {
    const T1 = new Date('2026-07-01T00:00:00Z');
    const T2 = new Date('2026-07-02T00:00:00Z');
    const original = { ...makeGame([{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }]), syncedAt: T1 } as Game;
    await StorageService.saveGames([original]);

    (saveGameToFirestore as jest.Mock).mockResolvedValue(undefined);   // confirms immediately
    await SyncService.saveGame(UID, { ...original, players: [{ id: 'A', name: 'Alice' }] } as Game);
    await flush();   // let the .then clear pendingSaves

    let resolveFetch!: (games: Game[]) => void;
    (fetchGamesFromFirestore as jest.Mock).mockReturnValue(new Promise<Game[]>(res => { resolveFetch = res; }));
    await SyncService.loadGames(UID, () => {});
    resolveFetch([{ ...original, players: [{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }, { id: 'C', name: 'Cara' }], syncedAt: T2 } as Game]);
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].players.map(p => p.id)).toEqual(['A', 'B', 'C']);   // remote won — protection released
  });

  it('clearPendingMutations() drops protection immediately', async () => {
    const T1 = new Date('2026-07-01T00:00:00Z');
    const T2 = new Date('2026-07-02T00:00:00Z');
    const original = { ...makeGame([{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }]), syncedAt: T1 } as Game;
    await StorageService.saveGames([original]);

    (saveGameToFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));   // stays pending
    await SyncService.saveGame(UID, { ...original, players: [{ id: 'A', name: 'Alice' }] } as Game);
    SyncService.clearPendingMutations();

    let resolveFetch!: (games: Game[]) => void;
    (fetchGamesFromFirestore as jest.Mock).mockReturnValue(new Promise<Game[]>(res => { resolveFetch = res; }));
    await SyncService.loadGames(UID, () => {});
    resolveFetch([{ ...original, players: [{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }, { id: 'C', name: 'Cara' }], syncedAt: T2 } as Game]);
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].players.map(p => p.id)).toEqual(['A', 'B', 'C']);   // no longer protected
  });

  it('keeps protection until the LAST of multiple in-flight saves confirms (ref-counted)', async () => {
    const T1 = new Date('2026-07-01T00:00:00Z');
    const T2 = new Date('2026-07-02T00:00:00Z');
    const original = { ...makeGame([{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }]), syncedAt: T1 } as Game;
    await StorageService.saveGames([original]);

    // Two rapid edits to the SAME game; BOTH Firestore writes are held in flight so we
    // control the confirmation order.
    let resolveSave1!: () => void;
    let resolveSave2!: () => void;
    (saveGameToFirestore as jest.Mock)
      .mockReturnValueOnce(new Promise<void>(res => { resolveSave1 = res; }))
      .mockReturnValueOnce(new Promise<void>(res => { resolveSave2 = res; }));

    await SyncService.saveGame(UID, { ...original, players: [{ id: 'A', name: 'Alice' }] } as Game);                          // edit #1: remove B
    await SyncService.saveGame(UID, { ...original, players: [{ id: 'A', name: 'Alice' }, { id: 'C', name: 'Cara' }] } as Game); // edit #2: add C (B still gone)

    // Only the FIRST write confirms. With a plain Set this would delete the shared id and
    // drop protection; with ref-counting the count goes 2 -> 1 and protection holds.
    resolveSave1();
    await flush();

    let resolveFetch!: (games: Game[]) => void;
    (fetchGamesFromFirestore as jest.Mock).mockReturnValue(new Promise<Game[]>(res => { resolveFetch = res; }));
    await SyncService.loadGames(UID, () => {});
    // Strictly-newer remote still has B and lacks C — must NOT clobber the still-pending edit #2.
    resolveFetch([{ ...original, players: [{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }], syncedAt: T2 } as Game]);
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].players.map(p => p.id)).toEqual(['A', 'C']);   // edit #2 still protected
  });

  it('does not protect a mutation made while signed out (uid null → no registry entry)', async () => {
    const T1 = new Date('2026-07-01T00:00:00Z');
    const T2 = new Date('2026-07-02T00:00:00Z');
    const original = { ...makeGame([{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }]), syncedAt: T1 } as Game;
    await StorageService.saveGames([original]);

    // Signed-out local edit — must NOT mark the registry.
    await SyncService.saveGame(null, { ...original, players: [{ id: 'A', name: 'Alice' }] } as Game);

    // A later signed-in background merge with strictly-newer remote should win (no protection).
    let resolveFetch!: (games: Game[]) => void;
    (fetchGamesFromFirestore as jest.Mock).mockReturnValue(new Promise<Game[]>(res => { resolveFetch = res; }));
    await SyncService.loadGames(UID, () => {});
    resolveFetch([{ ...original, players: [{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }, { id: 'C', name: 'Cara' }], syncedAt: T2 } as Game]);
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].players.map(p => p.id)).toEqual(['A', 'B', 'C']);   // remote won — not protected
  });

  it('releases protection if the LOCAL write fails (no permanent strand)', async () => {
    const T1 = new Date('2026-07-01T00:00:00Z');
    const T2 = new Date('2026-07-02T00:00:00Z');
    const original = { ...makeGame([{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }]), syncedAt: T1 } as Game;
    await StorageService.saveGames([original]);

    // Force the local AsyncStorage write to reject exactly once (the saveGame RMW).
    const saveSpy = jest.spyOn(StorageService, 'saveGames').mockRejectedValueOnce(new Error('disk full'));
    await expect(
      SyncService.saveGame(UID, { ...original, players: [{ id: 'A', name: 'Alice' }] } as Game),
    ).rejects.toThrow('disk full');
    saveSpy.mockRestore();

    // The failed save must not have left game1 protected — a newer remote should win.
    let resolveFetch!: (games: Game[]) => void;
    (fetchGamesFromFirestore as jest.Mock).mockReturnValue(new Promise<Game[]>(res => { resolveFetch = res; }));
    await SyncService.loadGames(UID, () => {});
    resolveFetch([{ ...original, players: [{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }, { id: 'C', name: 'Cara' }], syncedAt: T2 } as Game]);
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].players.map(p => p.id)).toEqual(['A', 'B', 'C']);   // remote won — mark released on failure
  });
});

describe('pending-mutations registry protects local deletes', () => {
  it('does not resurrect a game deleted locally while its Firestore delete is in flight', async () => {
    const T1 = new Date('2026-07-01T00:00:00Z');
    const T2 = new Date('2026-07-02T00:00:00Z');
    const game = { ...makeGame([{ id: 'A', name: 'Alice' }]), syncedAt: T1 } as Game;
    await StorageService.saveGames([game]);

    (deleteGameFromFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
    await SyncService.deleteGame(UID, game.id);

    let resolveFetch!: (games: Game[]) => void;
    (fetchGamesFromFirestore as jest.Mock).mockReturnValue(new Promise<Game[]>(res => { resolveFetch = res; }));
    const delivered: Game[][] = [];
    await SyncService.loadGames(UID, merged => { delivered.push(merged); });

    resolveFetch([{ ...game, syncedAt: T2 } as Game]);   // remote still has it, newer
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored).toEqual([]);
    expect(delivered[delivered.length - 1]).toEqual([]);
  });
});

describe('withStorageLock (write serialization, Limitation 2)', () => {
  const delay = (ms: number) => new Promise<void>(res => { setTimeout(res, ms); });

  it('runs concurrently-submitted ops one at a time in submission order', async () => {
    const order: string[] = [];
    const p1 = withStorageLock(async () => { order.push('1-start'); await delay(20); order.push('1-end'); });
    const p2 = withStorageLock(async () => { order.push('2-start'); await delay(0); order.push('2-end'); });
    await Promise.all([p1, p2]);
    expect(order).toEqual(['1-start', '1-end', '2-start', '2-end']);
  });

  it('returns the op result and runs the next op even after a rejection', async () => {
    await expect(withStorageLock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const result = await withStorageLock(async () => 42);
    expect(result).toBe(42);
  });
});

describe('reopen-vs-complete cross-device conflict (last-write-wins by syncedAt)', () => {
  const completedLater: Game = {
    ...makeGame([{ id: 'A', name: 'Alice' }]),
    status: 'completed',
    statsCounted: true,
    syncedAt: new Date('2026-07-02T00:00:00Z'),
  };

  it('a completion with the later syncedAt beats an earlier local reopen', async () => {
    const reopenedEarlier: Game = {
      ...makeGame([{ id: 'A', name: 'Alice' }]),
      status: 'active',
      statsCounted: false,
      syncedAt: new Date('2026-07-01T12:00:00Z'),
    };
    await StorageService.saveGames([reopenedEarlier]);
    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([completedLater]);

    await SyncService.loadGames(UID, () => {});
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].status).toBe('completed');
    expect(stored[0].statsCounted).toBe(true);
  });

  it('a reopen with the later syncedAt beats an earlier completion and propagates statsCounted: false', async () => {
    const reopenedLater: Game = {
      ...makeGame([{ id: 'A', name: 'Alice' }]),
      status: 'active',
      statsCounted: false,
      syncedAt: new Date('2026-07-03T00:00:00Z'),
    };
    await StorageService.saveGames([reopenedLater]);
    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([completedLater]);

    await SyncService.loadGames(UID, () => {});
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].status).toBe('active');
    expect(stored[0].statsCounted).toBe(false);
  });
});

describe('payment handles survive repeated app launches (the reported bug)', () => {
  // A handle added in an active game vanished after the SECOND app close.
  //
  // StorageService.loadGames() rebuilt players from a {id, name, completedAt}
  // whitelist, so every read dropped preferredPayment. Launch 1 still looked
  // fine: local syncedAt lags remote by one write (saveGame persists the
  // in-memory game while Firestore stamps serverTimestamp), so remote won the
  // merge and restored the handle — and wrote remote's syncedAt into local.
  // Launch 2 then had local syncedAt EQUAL to remote's, and mergeGames uses a
  // strict `remoteTime > localTime`, so the stripped local copy won and the
  // handle was gone for good.
  it('keeps a handle across two launches even once local syncedAt ties remote', async () => {
    const REMOTE_SYNCED = new Date('2026-07-02T00:00:00Z');
    // Local storage still models a legacy-only on-disk record: the UI (active.tsx et al.)
    // has not yet been migrated to write methods/defaultMethod (that's Tasks 5-8), so a
    // preferredPayment-only local record is exactly what saveGame leaves today.
    const withHandle = (syncedAt: Date): Game => ({
      ...makeGame([{ id: 'A', name: 'Alice' }]),
      players: [
        {
          id: 'A',
          name: 'Alice',
          preferredPayment: { method: 'venmo', handle: 'alice-h' },
          savedPlayerId: 'sp_alice',
        },
      ],
      syncedAt,
    });
    // Remote, in contrast, can NEVER be legacy-only shaped: fetchGamesFromFirestore always
    // runs deserializeFirestoreGame, which synthesizes methods/defaultMethod and drops
    // preferredPayment. Model that faithfully rather than a shape production can't produce.
    const remoteWithHandle = (syncedAt: Date): Game => ({
      ...makeGame([{ id: 'A', name: 'Alice' }]),
      players: [
        { id: 'A', name: 'Alice', methods: { venmo: 'alice-h' }, defaultMethod: 'venmo', savedPlayerId: 'sp_alice' },
      ],
      syncedAt,
    });

    // Local lags remote by one write, exactly as saveGame leaves it.
    await StorageService.saveGames([withHandle(new Date('2026-07-01T00:00:00Z'))]);
    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([remoteWithHandle(REMOTE_SYNCED)]);

    // ---- Launch 1: remote is newer, so it wins and stamps REMOTE_SYNCED locally.
    await SyncService.loadGames(UID, () => {});
    await flush();

    // Post-2.0.3, StorageService.loadGames() synthesizes methods/defaultMethod
    // from a legacy-only record and drops preferredPayment from the in-memory
    // object (see utils/paymentMethods.ts withSynthesizedMethods). The handle
    // itself must still survive — just carried on the new fields.
    const afterFirst = await StorageService.loadGames();
    expect(afterFirst[0].players[0].methods).toEqual({ venmo: 'alice-h' });
    expect(afterFirst[0].players[0].defaultMethod).toBe('venmo');

    // ---- Launch 2: local syncedAt now ties remote, so the LOCAL copy wins the
    // merge. It must still carry the handle — that is the whole bug.
    const secondLaunch = await SyncService.loadGames(UID, () => {});
    await flush();

    expect(secondLaunch[0].players[0].methods).toEqual({ venmo: 'alice-h' });
    expect(secondLaunch[0].players[0].defaultMethod).toBe('venmo');
    expect(secondLaunch[0].players[0].savedPlayerId).toBe('sp_alice');

    const afterSecond = await StorageService.loadGames();
    expect(afterSecond[0].players[0].methods).toEqual({ venmo: 'alice-h' });
    expect(afterSecond[0].players[0].defaultMethod).toBe('venmo');
  });

  it('saving one game does not strip a handle off another game', async () => {
    const gameWithHandle: Game = {
      ...makeGame([{ id: 'A', name: 'Alice' }]),
      id: 'gameA',
      players: [
        { id: 'A', name: 'Alice', preferredPayment: { method: 'cashapp', handle: 'alice-c' } },
      ],
    };
    const otherGame: Game = { ...makeGame([{ id: 'B', name: 'Bob' }]), id: 'gameB' };
    await StorageService.saveGames([gameWithHandle, otherGame]);

    // saveGame does loadGames -> replace target -> saveGames, so a lossy read
    // damages every untouched game caught in the same write.
    await SyncService.saveGame(UID, { ...otherGame, name: 'Saturday' });

    const stored = await StorageService.loadGames();
    const reloadedA = stored.find(g => g.id === 'gameA')!;
    expect(reloadedA.players[0].methods).toEqual({ cashapp: 'alice-c' });
    expect(reloadedA.players[0].defaultMethod).toBe('cashapp');
  });
});

describe('unionRecoverablePlayerFields — recovering handles the old whitelist stripped', () => {
  const local = (players: any[]): Game => ({ ...makeGame([]), players } as Game);

  it('adopts remote preferredPayment and savedPlayerId when local lost them', () => {
    const result = unionRecoverablePlayerFields(
      local([{ id: 'A', name: 'Alice' }]),
      local([
        {
          id: 'A',
          name: 'Alice',
          preferredPayment: { method: 'venmo', handle: 'alice-h' },
          savedPlayerId: 'sp_alice',
        },
      ]),
    );

    expect(result.players[0].preferredPayment).toEqual({ method: 'venmo', handle: 'alice-h' });
    expect(result.players[0].savedPlayerId).toBe('sp_alice');
  });

  it('never overwrites a payment the local copy already has', () => {
    const result = unionRecoverablePlayerFields(
      local([{ id: 'A', name: 'Alice', preferredPayment: { method: 'cash' } }]),
      local([{ id: 'A', name: 'Alice', preferredPayment: { method: 'venmo', handle: 'stale' } }]),
    );

    expect(result.players[0].preferredPayment).toEqual({ method: 'cash' });
  });

  it('does NOT resurrect a payment onto a RENAMED player (deliberate unbind)', () => {
    // active.tsx drops preferredPayment + savedPlayerId on rename when the new
    // name matches 0 or 2+ saved entries, so a later edit cannot write back to
    // the wrong saved entry. If that rename is made offline, remote still holds
    // the OLD person's handle — adopting it would show the wrong payee.
    const result = unionRecoverablePlayerFields(
      local([{ id: 'A', name: 'Bob' }]),
      local([
        {
          id: 'A',
          name: 'Alice',
          preferredPayment: { method: 'venmo', handle: 'alice-h' },
          savedPlayerId: 'sp_alice',
        },
      ]),
    );

    expect(result.players[0].preferredPayment).toBeUndefined();
    expect(result.players[0].savedPlayerId).toBeUndefined();
  });

  it('leaves players absent from remote untouched', () => {
    const input = local([{ id: 'Z', name: 'Zoe' }]);
    const result = unionRecoverablePlayerFields(input, local([]));
    expect(result.players[0].preferredPayment).toBeUndefined();
  });

  it('returns the SAME object when nothing is recoverable (no identity churn)', () => {
    const input = local([{ id: 'A', name: 'Alice', preferredPayment: { method: 'cash' } }]);
    const result = unionRecoverablePlayerFields(
      input,
      local([{ id: 'A', name: 'Alice', preferredPayment: { method: 'cash' } }]),
    );
    expect(result).toBe(input);
  });

  it('recovers through a real merge when local wins the syncedAt tie', async () => {
    const TIE = new Date('2026-07-02T00:00:00Z');
    const stripped: Game = {
      ...makeGame([{ id: 'A', name: 'Alice' }]),
      syncedAt: TIE,
    };
    // Remote is shaped as fetchGamesFromFirestore actually emits it — via
    // deserializeFirestoreGame, which synthesizes methods/defaultMethod and never
    // carries preferredPayment. A preferredPayment-shaped remote mock cannot occur.
    const remoteIntact: Game = {
      ...makeGame([{ id: 'A', name: 'Alice' }]),
      players: [
        { id: 'A', name: 'Alice', methods: { venmo: 'alice-h' }, defaultMethod: 'venmo', savedPlayerId: 'sp_alice' },
      ],
      syncedAt: TIE,
    };

    await StorageService.saveGames([stripped]);
    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([remoteIntact]);

    await SyncService.loadGames(UID, () => {});
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].players[0].methods).toEqual({ venmo: 'alice-h' });
    expect(stored[0].players[0].defaultMethod).toBe('venmo');
    expect(stored[0].players[0].savedPlayerId).toBe('sp_alice');
  });

  it('adopts remote methods and defaultMethod when local lost them', () => {
    const result = unionRecoverablePlayerFields(
      local([{ id: 'A', name: 'Alice' }]),
      local([{ id: 'A', name: 'Alice', methods: { venmo: 'alice-h' }, defaultMethod: 'venmo' }]),
    );
    expect(result.players[0].methods).toEqual({ venmo: 'alice-h' });
    expect(result.players[0].defaultMethod).toBe('venmo');
  });

  it('never overwrites a live local map with a stale remote one', () => {
    const input = local([{ id: 'A', name: 'Alice', methods: { cash: '' }, defaultMethod: 'cash' }]);
    const result = unionRecoverablePlayerFields(
      input,
      local([{ id: 'A', name: 'Alice', methods: { venmo: 'stale' }, defaultMethod: 'venmo' }]),
    );
    expect(result.players[0].methods).toEqual({ cash: '' });
    expect(result.players[0].defaultMethod).toBe('cash');
    // Nothing was adopted, so identity must be preserved on the methods/defaultMethod
    // path too — callers rely on this to avoid churning memoised references.
    expect(result).toBe(input);
  });

  it('does not pair a local methods map with a remote defaultMethod (R-16)', () => {
    // The exact input R-16 exists for: local has a map but no default, remote has
    // both. Resolving the two fields independently (lp.defaultMethod ?? rp.defaultMethod)
    // would pair local's map with remote's default — a pair that existed on neither
    // device. If pairing regresses back to independent resolution, this is the one
    // input that flips: the other adopt/no-overwrite tests produce the same result
    // under either implementation and would stay green through such a revert.
    const result = unionRecoverablePlayerFields(
      local([{ id: 'A', name: 'Alice', methods: { venmo: 'v' } }]),
      local([{ id: 'A', name: 'Alice', methods: { zelle: 'z' }, defaultMethod: 'zelle' }]),
    );
    expect(result.players[0].methods).toEqual({ venmo: 'v' });
    expect(result.players[0].defaultMethod).toBeUndefined();
  });

  it('does not adopt across a rename (the deliberate-drop guard)', () => {
    const result = unionRecoverablePlayerFields(
      local([{ id: 'A', name: 'Alicia' }]),
      local([{ id: 'A', name: 'Alice', methods: { venmo: 'alice-h' }, defaultMethod: 'venmo' }]),
    );
    expect(result.players[0].methods).toBeUndefined();
  });
});

describe('deleteGame — the share document dies with the game', () => {
  it('deletes the share document when the game has a shareId', async () => {
    const game = makeGame([{ id: 'A', name: 'Alice' }]);
    await StorageService.saveGames([game]);

    await SyncService.deleteGame(UID, game.id, 'aB3dEfGh1JkLmN0pQrSt');
    await flush();

    expect(deleteSharedGame).toHaveBeenCalledWith('aB3dEfGh1JkLmN0pQrSt');
    expect(deleteGameFromFirestore).toHaveBeenCalledWith(UID, game.id);
  });

  it('does not touch /sharedGames when the game was never shared', async () => {
    const game = makeGame([{ id: 'A', name: 'Alice' }]);
    await StorageService.saveGames([game]);

    await SyncService.deleteGame(UID, game.id);
    await flush();

    expect(deleteSharedGame).not.toHaveBeenCalled();
  });

  it('does not touch /sharedGames when signed out', async () => {
    // No uid means no Firestore identity, so the owner-only delete rule could
    // not pass anyway. The document then survives until the TTL sweeps it —
    // which is why the TTL policy blocks the release.
    const game = makeGame([{ id: 'A', name: 'Alice' }]);
    await StorageService.saveGames([game]);

    await SyncService.deleteGame(null, game.id, 'aB3dEfGh1JkLmN0pQrSt');
    await flush();

    expect(deleteSharedGame).not.toHaveBeenCalled();
  });

  it('still removes the game locally when the share delete rejects', async () => {
    // Fire-and-forget: a failed share delete must not block or throw.
    (deleteSharedGame as jest.Mock).mockRejectedValueOnce(new Error('nope'));
    const game = makeGame([{ id: 'A', name: 'Alice' }]);
    await StorageService.saveGames([game]);

    await SyncService.deleteGame(UID, game.id, 'aB3dEfGh1JkLmN0pQrSt');
    await flush();

    expect(await StorageService.loadGames()).toHaveLength(0);
  });

  it('deleteGame() itself does not await the share delete (a never-settling deleteSharedGame cannot hang it)', async () => {
    // The case above proves deleteSharedGame is not awaited-with-no-catch (a
    // rejection there does not throw out of deleteGame). It cannot distinguish
    // that from an awaited-but-internally-caught call, because local removal
    // happens earlier in deleteGame either way and the test awaits + flushes
    // regardless of which shape deleteGame uses internally.
    //
    // That distinction matters: offline, deleteDoc enters Firestore's persisted
    // mutation queue and never settles (see syncService.ts's deleteGame
    // docstring). If deleteGame awaited deleteSharedGame — even inside a
    // try/catch — an offline share delete would hang deleteGame forever, and
    // with it GameContext.deleteGame and the delete-confirm UI. Making the mock
    // never settle and asserting deleteGame() still resolves is what actually
    // rules that out.
    (deleteSharedGame as jest.Mock).mockReturnValueOnce(new Promise(() => {}));
    const game = makeGame([{ id: 'A', name: 'Alice' }]);
    await StorageService.saveGames([game]);

    await SyncService.deleteGame(UID, game.id, 'aB3dEfGh1JkLmN0pQrSt');
    await flush();

    expect(await StorageService.loadGames()).toHaveLength(0);
  });
});
