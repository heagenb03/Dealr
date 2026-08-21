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
import { withSynthesizedMethods } from '@/utils/paymentMethods';

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
  SyncService.clearPendingMutations();   // AsyncStorage.clear() above drops the durable half
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

  it('a user switch drops protection immediately (both halves cleared)', async () => {
    const T1 = new Date('2026-07-01T00:00:00Z');
    const T2 = new Date('2026-07-02T00:00:00Z');
    const original = { ...makeGame([{ id: 'A', name: 'Alice' }, { id: 'B', name: 'Bob' }]), syncedAt: T1 } as Game;
    await StorageService.saveGames([original]);

    (saveGameToFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));   // stays pending
    await SyncService.saveGame(UID, { ...original, players: [{ id: 'A', name: 'Alice' }] } as Game);
    // A user switch drops BOTH halves — GameContext calls clearPendingMutations() and
    // StorageService.clearAll() on the same path. Clearing memory ALONE is process death,
    // which deliberately keeps its markers; see the restart block at the end of this file.
    SyncService.clearPendingMutations();
    await StorageService.savePendingMutations({ uid: null, saves: [], deletes: [] });

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
    const GAMES_KEY = '@cashcage:games';
    const REMOTE_SYNCED = new Date('2026-07-02T00:00:00Z');
    // Local storage models a genuine legacy on-disk record: seeded as raw JSON, never
    // through the typed Player API (which post-Task 9 has no field to hold this shape —
    // preferredPayment cannot live on an in-memory Player at all). This is exactly what a
    // device that wrote this game before methods/defaultMethod existed still has on disk.
    const rawLegacyGame = (syncedAt: string) => ({
      id: 'game1',
      name: 'Friday Night',
      date: '2026-07-01T00:00:00.000Z',
      status: 'active',
      players: [
        {
          id: 'A',
          name: 'Alice',
          preferredPayment: { method: 'venmo', handle: 'alice-h' },
          savedPlayerId: 'sp_alice',
        },
      ],
      transactions: [],
      createdAt: '2026-07-01T00:00:00.000Z',
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
    await AsyncStorage.setItem(GAMES_KEY, JSON.stringify([rawLegacyGame('2026-07-01T00:00:00.000Z')]));
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
        { id: 'A', name: 'Alice', methods: { cashapp: 'alice-c' }, defaultMethod: 'cashapp' },
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

describe('2.0.2 interop: a stripped remote write wins the merge outright', () => {
  // This pins a DELIBERATE TRADE-OFF, not a bug. Spec §6 originally asked for a test where
  // "local has methods, remote lost them, remote is newer, methods survive" — they do not,
  // and cannot: unionRecoverablePlayerFields only ever fills LOCAL from REMOTE, and a 2.0.2
  // write makes remote the impoverished side. Its write also carries a newer syncedAt, so
  // mergeGames takes the remote copy wholesale by last-write-wins and the union never runs.
  // What survives is the DEFAULT method, carried by the dual-written preferredPayment that
  // 2.0.2 preserves verbatim and this app re-synthesizes into `methods` on read. The
  // non-default methods 2.0.2 could not represent are lost — the same accepted cost spec §4
  // states for the saved pool (a payment set is replaced as a unit, never unioned per key).
  // See the doc comment on unionRecoverablePlayerFields. Spec §2/§6 now say the same.
  it('keeps the default method and drops the non-default ones (accepted cost)', async () => {
    const LOCAL_SYNCED = new Date('2026-07-02T00:00:00Z');
    // Strictly newer: the 2.0.2 device edited the game last, so remote wins outright.
    const REMOTE_SYNCED = new Date('2026-07-03T00:00:00Z');

    const localWithBoth: Game = {
      ...makeGame([{ id: 'A', name: 'Alice' }]),
      players: [
        { id: 'A', name: 'Alice', methods: { venmo: 'a', zelle: 'z' }, defaultMethod: 'venmo' },
      ],
      syncedAt: LOCAL_SYNCED,
    };

    // The 2.0.2 wire shape: its firebaseService deserializer whitelists players down to
    // preferredPayment + savedPlayerId, so a game it edits goes back to Firestore carrying
    // only preferredPayment. Build the remote Game by running the REAL withSynthesizedMethods
    // over that raw player — the same function deserializeFirestoreGame applies per player —
    // rather than hand-writing the post-deserialize shape, so this stays bound to the
    // production read boundary. (@/services/firebaseService itself is mocked at the top of
    // this file, and requireActual would drag firebase/firestore in.)
    const remoteFrom202: Game = {
      ...makeGame([{ id: 'A', name: 'Alice' }]),
      players: [
        withSynthesizedMethods({
          id: 'A',
          name: 'Alice',
          preferredPayment: { method: 'venmo' as const, handle: 'a' },
        }),
      ],
      syncedAt: REMOTE_SYNCED,
    };

    await StorageService.saveGames([localWithBoth]);
    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([remoteFrom202]);

    await SyncService.loadGames(UID, () => {});
    await flush();

    const stored = await StorageService.loadGames();
    // toEqual on the WHOLE map, so zelle's absence is structural rather than a
    // separate assertion that could be deleted on its own.
    expect(stored[0].players[0].methods).toEqual({ venmo: 'a' });
    expect(stored[0].players[0].defaultMethod).toBe('venmo');
  });
});

describe('unionRecoverablePlayerFields — recovering handles the old whitelist stripped', () => {
  const local = (players: any[]): Game => ({ ...makeGame([]), players } as Game);

  it('adopts remote methods/defaultMethod and savedPlayerId when local lost them', () => {
    const result = unionRecoverablePlayerFields(
      local([{ id: 'A', name: 'Alice' }]),
      local([
        { id: 'A', name: 'Alice', methods: { venmo: 'alice-h' }, defaultMethod: 'venmo', savedPlayerId: 'sp_alice' },
      ]),
    );

    expect(result.players[0].methods).toEqual({ venmo: 'alice-h' });
    expect(result.players[0].defaultMethod).toBe('venmo');
    expect(result.players[0].savedPlayerId).toBe('sp_alice');
  });

  it('does NOT resurrect a payment onto a RENAMED player (deliberate unbind)', () => {
    // active.tsx drops methods/defaultMethod + savedPlayerId on rename when the new
    // name matches 0 or 2+ saved entries, so a later edit cannot write back to
    // the wrong saved entry. If that rename is made offline, remote still holds
    // the OLD person's handle — adopting it would show the wrong payee.
    const result = unionRecoverablePlayerFields(
      local([{ id: 'A', name: 'Bob' }]),
      local([
        { id: 'A', name: 'Alice', methods: { venmo: 'alice-h' }, defaultMethod: 'venmo', savedPlayerId: 'sp_alice' },
      ]),
    );

    expect(result.players[0].methods).toBeUndefined();
    expect(result.players[0].savedPlayerId).toBeUndefined();
  });

  it('leaves players absent from remote untouched', () => {
    const input = local([{ id: 'Z', name: 'Zoe' }]);
    const result = unionRecoverablePlayerFields(input, local([]));
    expect(result.players[0].methods).toBeUndefined();
  });

  it('returns the SAME object when nothing is recoverable (no identity churn)', () => {
    const input = local([{ id: 'A', name: 'Alice', methods: { cash: '' }, defaultMethod: 'cash' }]);
    const result = unionRecoverablePlayerFields(
      input,
      local([{ id: 'A', name: 'Alice', methods: { cash: '' }, defaultMethod: 'cash' }]),
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

describe('process restart drops protection for an unpushed edit (the reported 2.0.2 bug)', () => {
  const T1 = new Date('2026-07-01T00:00:00Z');
  const T2 = new Date('2026-07-02T00:00:00Z');

  const tx = (id: string, amount: number) => ({
    id,
    playerId: 'A',
    type: 'buyin' as const,
    amount,
    timestamp: new Date('2026-07-01T12:00:00Z'),
  });

  const withTx = (transactions: ReturnType<typeof tx>[], syncedAt: Date): Game =>
    ({ ...makeGame([{ id: 'A', name: 'Alice' }]), transactions, syncedAt } as Game);

  it('keeps a buy-in whose Firestore write never acked before the app was reclaimed', async () => {
    // --- Launch 1 ---------------------------------------------------------
    // In sync with remote: one buy-in, stamped T1 by the server on the last write.
    await StorageService.saveGames([withTx([tx('t1', 20)], T1)]);

    // Edit 1 — add t2. The local Game still carries syncedAt T1: nothing writes the
    // server stamp back (firebaseService.ts:401 strips syncedAt from the payload, :404
    // replaces it with serverTimestamp(), saveGameToFirestore returns void). This write
    // ACKS, so the server moves to T2 while local stays on T1 with identical content.
    (saveGameToFirestore as jest.Mock).mockResolvedValue(undefined);
    await SyncService.saveGame(UID, withTx([tx('t1', 20), tx('t2', 20)], T1));
    await flush();   // the ack clears this game from pendingSaves

    // Edit 2 — add t3. Reaches AsyncStorage, but its Firestore write never acks
    // (phone locked / weak signal). Local content is now strictly ahead of remote
    // while still carrying the STALE T1.
    (saveGameToFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
    await SyncService.saveGame(UID, withTx([tx('t1', 20), tx('t2', 20), tx('t3', 20)], T1));

    // --- iOS reclaims the suspended app -----------------------------------
    // Module state dies with the process: pendingSaves is empty on relaunch and the
    // un-acked write goes with it. AsyncStorage survives. This stands in for process
    // death — unlike the user-switch case the clearPendingMutations test above models,
    // dropping protection here is what destroys data.
    SyncService.clearPendingMutations();

    // --- Launch 2 ---------------------------------------------------------
    // The server still holds the edit-1 state stamped T2: OLDER content, NEWER
    // timestamp. mergeGames (syncService.ts:251-256) takes it and t3 is destroyed.
    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([
      withTx([tx('t1', 20), tx('t2', 20)], T2),
    ]);
    const delivered: Game[][] = [];
    await SyncService.loadGames(UID, merged => { delivered.push(merged); });
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].transactions.map(t => t.id)).toEqual(['t1', 't2', 't3']);
    expect(delivered[delivered.length - 1][0].transactions.map(t => t.id)).toEqual(['t1', 't2', 't3']);
  });

  // Control for the fix, not for the bug: this one passes TODAY and must keep passing.
  // Without it, a fix could read "remote is a superset -> take remote, else keep local"
  // and go green on the case above while silently reverting a real cross-device delete.
  // Only a durable per-game dirty flag satisfies both.
  it('still takes a genuinely newer remote when local has NO unpushed edit', async () => {
    await StorageService.saveGames([withTx([tx('t1', 20)], T1)]);

    // Every local write acked, so nothing is unpushed when the process dies.
    (saveGameToFirestore as jest.Mock).mockResolvedValue(undefined);
    await SyncService.saveGame(UID, withTx([tx('t1', 20), tx('t2', 20)], T1));
    await flush();
    SyncService.clearPendingMutations();   // process death, as above

    // Another device removed t2 and added t4, stamped T2. That is a real edit and
    // must win — local is stale here, not ahead.
    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([
      withTx([tx('t1', 20), tx('t4', 50)], T2),
    ]);
    await SyncService.loadGames(UID, () => {});
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].transactions.map(t => t.id)).toEqual(['t1', 't4']);
  });

  it('does not resurrect a game whose delete never acked before the app was reclaimed', async () => {
    await StorageService.saveGames([withTx([tx('t1', 20)], T1)]);

    (deleteGameFromFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
    await SyncService.deleteGame(UID, 'game1');

    SyncService.clearPendingMutations();   // process death — durable markers survive

    // mergeGames re-adds a remote-only game unconditionally (syncService.ts:246-248),
    // so without a durable delete marker this comes straight back. No timestamp is
    // involved: this half of the bug needs no stale syncedAt at all.
    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([withTx([tx('t1', 20)], T2)]);
    const delivered: Game[][] = [];
    await SyncService.loadGames(UID, merged => { delivered.push(merged); });
    await flush();

    expect(await StorageService.loadGames()).toEqual([]);
    expect(delivered[delivered.length - 1]).toEqual([]);
  });

  it('re-pushes the unacked write on the next launch and clears the marker on ack', async () => {
    await StorageService.saveGames([withTx([tx('t1', 20)], T1)]);
    (saveGameToFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
    await SyncService.saveGame(UID, withTx([tx('t1', 20), tx('t2', 20)], T1));

    SyncService.clearPendingMutations();   // process death
    (saveGameToFirestore as jest.Mock).mockReset();
    (saveGameToFirestore as jest.Mock).mockResolvedValue(undefined);   // network is back

    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([withTx([tx('t1', 20)], T2)]);
    await SyncService.loadGames(UID, () => {});
    await flush();

    // The push carries t2 — the transaction the server never received. Protection alone
    // would have kept it on the device and never got it off there.
    expect(saveGameToFirestore).toHaveBeenCalledTimes(1);
    const pushed = (saveGameToFirestore as jest.Mock).mock.calls[0][1] as Game;
    expect(pushed.transactions.map(t => t.id)).toEqual(['t1', 't2']);

    // And the ack cleared the marker, so nothing stays protected.
    expect(await StorageService.loadPendingMutations()).toEqual({ uid: UID, saves: [], deletes: [] });
  });

  it('lets a newer remote win on the launch after the re-push acked (no permanent lock)', async () => {
    await StorageService.saveGames([withTx([tx('t1', 20)], T1)]);
    (saveGameToFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
    await SyncService.saveGame(UID, withTx([tx('t1', 20), tx('t2', 20)], T1));

    SyncService.clearPendingMutations();   // process death
    (saveGameToFirestore as jest.Mock).mockReset();
    (saveGameToFirestore as jest.Mock).mockResolvedValue(undefined);

    // Launch 2: re-push acks, marker clears.
    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([withTx([tx('t1', 20)], T2)]);
    await SyncService.loadGames(UID, () => {});
    await flush();

    // Launch 3: another device's newer state must now win — the game is no longer
    // protected, which is the failure mode a protect-only fix would have shipped.
    const T3 = new Date('2026-07-03T00:00:00Z');
    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([
      withTx([tx('t1', 20), tx('t2', 20), tx('t5', 99)], T3),
    ]);
    await SyncService.loadGames(UID, () => {});
    await flush();

    const stored = await StorageService.loadGames();
    expect(stored[0].transactions.map(t => t.id)).toEqual(['t1', 't2', 't5']);
  });

  it('re-pushes a hydrated marker once even when loadGames runs again on reconnect', async () => {
    await StorageService.saveGames([withTx([tx('t1', 20)], T1)]);
    (saveGameToFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
    await SyncService.saveGame(UID, withTx([tx('t1', 20), tx('t2', 20)], T1));

    SyncService.clearPendingMutations();   // process death
    (saveGameToFirestore as jest.Mock).mockReset();
    // Still stuck, so the marker is NOT cleared between the two loads — the only thing
    // stopping a second push is the hydratedIds drain, not the ack.
    (saveGameToFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));

    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([withTx([tx('t1', 20)], T2)]);
    await SyncService.loadGames(UID, () => {});
    await flush();
    await SyncService.loadGames(UID, () => {});   // NetworkContext reconnect re-sync
    await flush();

    expect(saveGameToFirestore).toHaveBeenCalledTimes(1);
    // Still marked, so the edit is still protected across both loads.
    expect(await StorageService.loadPendingMutations()).toEqual({ uid: UID, saves: ['game1'], deletes: [] });
    expect((await StorageService.loadGames())[0].transactions.map(t => t.id)).toEqual(['t1', 't2']);
  });

  it('discards markers left behind by another account instead of pushing them', async () => {
    // GameContext swallows a failed StorageService.clearAll() on user switch, so this
    // state is reachable: the previous account's games AND markers both survive. The
    // outbox is a PUSH path, so hydrating these would write user1's game into user2's
    // Firestore collection.
    await StorageService.saveGames([withTx([tx('t1', 20), tx('t2', 20)], T1)]);
    await StorageService.savePendingMutations({ uid: UID, saves: ['game1'], deletes: [] });

    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([]);
    await SyncService.loadGames('a-different-user', () => {});
    await flush();

    expect(saveGameToFirestore).not.toHaveBeenCalled();
    expect(deleteGameFromFirestore).not.toHaveBeenCalled();
    // Dropped and restamped, so they cannot be picked up on a later launch either.
    expect(await StorageService.loadPendingMutations()).toEqual({
      uid: 'a-different-user', saves: [], deletes: [],
    });
  });

  it('carries a full payment method set through the re-push, not just the default', async () => {
    // The outbox pushes a game read back through StorageService.loadGames (which runs
    // withSynthesizedMethods) and out through saveGameToFirestore (which runs
    // withLegacyPayment). None of the tests above exercise a payment handle on that
    // round-trip, and a non-default method lost here would be silent.
    const paid = {
      ...withTx([tx('t1', 20)], T1),
      players: [{
        id: 'A',
        name: 'Alice',
        methods: { venmo: '@alice', zelle: 'alice@example.com' },
        defaultMethod: 'zelle',
      }],
    } as unknown as Game;
    await StorageService.saveGames([paid]);

    (saveGameToFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
    await SyncService.saveGame(UID, { ...paid, transactions: [tx('t1', 20), tx('t2', 20)] } as Game);

    SyncService.clearPendingMutations();   // process death
    (saveGameToFirestore as jest.Mock).mockReset();
    (saveGameToFirestore as jest.Mock).mockResolvedValue(undefined);

    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([]);
    await SyncService.loadGames(UID, () => {});
    await flush();

    expect(saveGameToFirestore).toHaveBeenCalledTimes(1);
    const pushed = (saveGameToFirestore as jest.Mock).mock.calls[0][1] as Game;
    expect(pushed.transactions.map(t => t.id)).toEqual(['t1', 't2']);
    // Both methods survive, and the default is still the default.
    expect(pushed.players[0].methods).toEqual({ venmo: '@alice', zelle: 'alice@example.com' });
    expect(pushed.players[0].defaultMethod).toBe('zelle');
  });

  it('hydrates once per uid, so a reconnect re-sync does not wait on the storage lock', async () => {
    await StorageService.saveGames([withTx([tx('t1', 20)], T1)]);
    (saveGameToFirestore as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
    await SyncService.saveGame(UID, withTx([tx('t1', 20), tx('t2', 20)], T1));
    SyncService.clearPendingMutations();   // process death

    const spy = jest.spyOn(StorageService, 'loadPendingMutations');
    (fetchGamesFromFirestore as jest.Mock).mockResolvedValue([]);

    await SyncService.loadGames(UID, () => {});
    await flush();
    await SyncService.loadGames(UID, () => {});   // NetworkContext reconnect re-sync
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);

    // A uid CHANGE must still re-check, or another account's markers go unexamined.
    await SyncService.loadGames('a-different-user', () => {});
    await flush();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
