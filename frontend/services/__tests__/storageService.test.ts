import AsyncStorage from '@react-native-async-storage/async-storage';

import { Game } from '@/types/game';
import { StorageService } from '@/services/storageService';

// Not exported from storageService.ts — mirrors the literal at storageService.ts:4.
const GAMES_KEY = '@cashcage:games';

// ---------------------------------------------------------------------------
// StorageService round-trip fidelity.
//
// loadGames() used to rebuild each player from an explicit whitelist
// ({id, name, completedAt}), silently dropping preferredPayment and
// savedPlayerId on every read. Because the stripped result is written back —
// by the background sync merge, and by every saveGame's read-modify-write —
// the loss propagated to Firestore and became permanent.
//
// Post-2.0.3, preferredPayment itself is derive-on-write only (see
// withLegacyPayment/withSynthesizedMethods in utils/paymentMethods.ts) — it is
// written to storage for a shipped 2.0.2 reader, but never carried in the
// in-memory Game returned by loadGames. The tests below that predate this
// change now assert the field on `methods`/`defaultMethod` instead, and check
// the raw AsyncStorage record where they need to prove the legacy field is
// still being written.
// ---------------------------------------------------------------------------

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game1',
    name: 'Friday Night',
    date: new Date('2026-07-01T00:00:00Z'),
    status: 'active',
    players: [],
    transactions: [],
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  } as Game;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('StorageService.loadGames — player field fidelity', () => {
  it('round-trips preferredPayment and savedPlayerId on a player', async () => {
    // Source of truth is methods/defaultMethod, NOT preferredPayment — the player is
    // never given one. That makes the raw-store check below prove real DERIVATION on
    // write, rather than merely passing an already-present field through unchanged.
    const game = makeGame({
      players: [
        {
          id: 'p1',
          name: 'Alice',
          methods: { venmo: 'alice-h' },
          defaultMethod: 'venmo',
          savedPlayerId: 'sp_alice',
        },
      ],
    });

    await StorageService.saveGames([game]);
    const [loaded] = await StorageService.loadGames();

    // preferredPayment itself no longer lives on the in-memory object — Player has no
    // such field to check via the type system, so cast to prove it at runtime too.
    expect(loaded.players[0].methods).toEqual({ venmo: 'alice-h' });
    expect(loaded.players[0].defaultMethod).toBe('venmo');
    expect((loaded.players[0] as any).preferredPayment).toBeUndefined();
    expect(loaded.players[0].savedPlayerId).toBe('sp_alice');

    // The legacy field IS still on the raw store, derived from methods, for a
    // shipped 2.0.2 reader.
    const raw = JSON.parse((await AsyncStorage.getItem(GAMES_KEY)) as string);
    expect(raw[0].players[0].preferredPayment).toEqual({ method: 'venmo', handle: 'alice-h' });
  });

  it('round-trips a preferredPayment with no handle (e.g. cash)', async () => {
    // Again sourced from methods/defaultMethod (a label-only entry: present with no
    // handle), not a pre-existing preferredPayment, so the raw-store check proves
    // derivation rather than pass-through.
    const game = makeGame({
      players: [{ id: 'p1', name: 'Alice', methods: { cash: '' }, defaultMethod: 'cash' }],
    });

    await StorageService.saveGames([game]);
    const [loaded] = await StorageService.loadGames();

    expect(loaded.players[0].methods).toEqual({ cash: '' });
    expect(loaded.players[0].defaultMethod).toBe('cash');

    const raw = JSON.parse((await AsyncStorage.getItem(GAMES_KEY)) as string);
    expect(raw[0].players[0].preferredPayment).toEqual({ method: 'cash' });
  });

  it('still deserializes completedAt into a Date and leaves it undefined when absent', async () => {
    const game = makeGame({
      players: [
        { id: 'p1', name: 'Alice', completedAt: new Date('2026-07-02T10:00:00Z') },
        { id: 'p2', name: 'Bob' },
      ],
    });

    await StorageService.saveGames([game]);
    const [loaded] = await StorageService.loadGames();

    expect(loaded.players[0].completedAt).toBeInstanceOf(Date);
    expect(loaded.players[0].completedAt?.toISOString()).toBe('2026-07-02T10:00:00.000Z');
    expect(loaded.players[1].completedAt).toBeUndefined();
  });

  it('survives repeated load/save cycles — the user-reported "gone after the 2nd close"', async () => {
    const game = makeGame({
      players: [
        { id: 'p1', name: 'Alice', methods: { cashapp: 'alice-c' }, defaultMethod: 'cashapp' },
      ],
    });
    await StorageService.saveGames([game]);

    // Each app launch reads storage and (via sync merge / saveGame) writes it back.
    for (let launch = 0; launch < 3; launch++) {
      const loaded = await StorageService.loadGames();
      await StorageService.saveGames(loaded);
    }

    const [final] = await StorageService.loadGames();
    expect(final.players[0].methods).toEqual({ cashapp: 'alice-c' });
    expect(final.players[0].defaultMethod).toBe('cashapp');

    // The re-derived legacy field must not decay across cycles either.
    const raw = JSON.parse((await AsyncStorage.getItem(GAMES_KEY)) as string);
    expect(raw[0].players[0].preferredPayment).toEqual({ method: 'cashapp', handle: 'alice-c' });
  });

  it('does not strip other games when storage is read and written back', async () => {
    // SyncService.saveGame does loadGames -> replace one game -> saveGames, so a
    // lossy read damages every *untouched* game in the same write.
    const gameA = makeGame({
      id: 'gameA',
      players: [{ id: 'p1', name: 'Alice', methods: { venmo: 'a-h' }, defaultMethod: 'venmo' }],
    });
    const gameB = makeGame({ id: 'gameB', players: [{ id: 'p2', name: 'Bob' }] });
    await StorageService.saveGames([gameA, gameB]);

    const current = await StorageService.loadGames();
    const editedB = { ...gameB, name: 'Saturday' };
    await StorageService.saveGames(current.map(g => (g.id === 'gameB' ? editedB : g)));

    const loadedA = (await StorageService.loadGames()).find(g => g.id === 'gameA')!;
    expect(loadedA.players[0].methods).toEqual({ venmo: 'a-h' });
    expect(loadedA.players[0].defaultMethod).toBe('venmo');
  });
});

describe('StorageService.loadGames — game field fidelity', () => {
  it('round-trips defaultBuyIn, including an explicit 0 (off)', async () => {
    await StorageService.saveGames([
      makeGame({ id: 'g1', defaultBuyIn: 20 }),
      makeGame({ id: 'g2', defaultBuyIn: 0 }),
    ]);
    const loaded = await StorageService.loadGames();

    expect(loaded.find(g => g.id === 'g1')?.defaultBuyIn).toBe(20);
    expect(loaded.find(g => g.id === 'g2')?.defaultBuyIn).toBe(0);
  });
});

describe('StorageService — methods/defaultMethod persistence and legacy dual-write', () => {
  it('round-trips methods and defaultMethod on a player', async () => {
    const game: any = {
      id: 'g1', name: 'G', date: new Date(), createdAt: new Date(), status: 'active',
      players: [{ id: 'p1', name: 'Alice', methods: { venmo: 'alice-h', zelle: 'a@x.com' }, defaultMethod: 'zelle' }],
      transactions: [],
    };
    await StorageService.saveGames([game]);
    const loaded = (await StorageService.loadGames())[0];
    expect(loaded.players[0].methods).toEqual({ venmo: 'alice-h', zelle: 'a@x.com' });
    expect(loaded.players[0].defaultMethod).toBe('zelle');
  });

  it('writes a derived legacy preferredPayment for a 2.0.2 reader', async () => {
    const game: any = {
      id: 'g1', name: 'G', date: new Date(), createdAt: new Date(), status: 'active',
      players: [{ id: 'p1', name: 'Alice', methods: { venmo: 'alice-h', zelle: 'a@x.com' }, defaultMethod: 'zelle' }],
      transactions: [],
    };
    await StorageService.saveGames([game]);
    const raw = JSON.parse((await AsyncStorage.getItem(GAMES_KEY)) as string);
    expect(raw[0].players[0].preferredPayment).toEqual({ method: 'zelle', handle: 'a@x.com' });
  });

  it('synthesizes methods from a legacy-only stored record', async () => {
    await AsyncStorage.setItem(GAMES_KEY, JSON.stringify([{
      id: 'g1', name: 'G', date: new Date().toISOString(), createdAt: new Date().toISOString(), status: 'active',
      players: [{ id: 'p1', name: 'Alice', preferredPayment: { method: 'venmo', handle: 'alice-h' } }],
      transactions: [],
    }]));
    const loaded = (await StorageService.loadGames())[0];
    expect(loaded.players[0].methods).toEqual({ venmo: 'alice-h' });
    expect(loaded.players[0].defaultMethod).toBe('venmo');
  });

  it('synthesizes a label-only legacy record without inventing a handle', async () => {
    await AsyncStorage.setItem(GAMES_KEY, JSON.stringify([{
      id: 'g1', name: 'G', date: new Date().toISOString(), createdAt: new Date().toISOString(), status: 'active',
      players: [{ id: 'p1', name: 'Alice', preferredPayment: { method: 'venmo' } }],
      transactions: [],
    }]));
    const loaded = (await StorageService.loadGames())[0];
    expect(loaded.players[0].methods).toEqual({ venmo: '' });
    expect(loaded.players[0].defaultMethod).toBe('venmo');
  });

  it('prefers stored methods over a stale legacy field when both are present', async () => {
    await AsyncStorage.setItem(GAMES_KEY, JSON.stringify([{
      id: 'g1', name: 'G', date: new Date().toISOString(), createdAt: new Date().toISOString(), status: 'active',
      players: [{
        id: 'p1', name: 'Alice',
        preferredPayment: { method: 'venmo', handle: 'stale' },
        methods: { cashapp: 'fresh' }, defaultMethod: 'cashapp',
      }],
      transactions: [],
    }]));
    const loaded = (await StorageService.loadGames())[0];
    expect(loaded.players[0].methods).toEqual({ cashapp: 'fresh' });
    expect(loaded.players[0].defaultMethod).toBe('cashapp');
  });
});
