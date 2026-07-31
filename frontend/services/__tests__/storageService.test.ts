import AsyncStorage from '@react-native-async-storage/async-storage';

import { Game } from '@/types/game';
import { StorageService } from '@/services/storageService';

// ---------------------------------------------------------------------------
// StorageService round-trip fidelity.
//
// loadGames() used to rebuild each player from an explicit whitelist
// ({id, name, completedAt}), silently dropping preferredPayment and
// savedPlayerId on every read. Because the stripped result is written back —
// by the background sync merge, and by every saveGame's read-modify-write —
// the loss propagated to Firestore and became permanent.
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
    const game = makeGame({
      players: [
        {
          id: 'p1',
          name: 'Alice',
          preferredPayment: { method: 'venmo', handle: 'alice-h' },
          savedPlayerId: 'sp_alice',
        },
      ],
    });

    await StorageService.saveGames([game]);
    const [loaded] = await StorageService.loadGames();

    expect(loaded.players[0].preferredPayment).toEqual({ method: 'venmo', handle: 'alice-h' });
    expect(loaded.players[0].savedPlayerId).toBe('sp_alice');
  });

  it('round-trips a preferredPayment with no handle (e.g. cash)', async () => {
    const game = makeGame({
      players: [{ id: 'p1', name: 'Alice', preferredPayment: { method: 'cash' } }],
    });

    await StorageService.saveGames([game]);
    const [loaded] = await StorageService.loadGames();

    expect(loaded.players[0].preferredPayment).toEqual({ method: 'cash' });
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
        { id: 'p1', name: 'Alice', preferredPayment: { method: 'cashapp', handle: 'alice-c' } },
      ],
    });
    await StorageService.saveGames([game]);

    // Each app launch reads storage and (via sync merge / saveGame) writes it back.
    for (let launch = 0; launch < 3; launch++) {
      const loaded = await StorageService.loadGames();
      await StorageService.saveGames(loaded);
    }

    const [final] = await StorageService.loadGames();
    expect(final.players[0].preferredPayment).toEqual({ method: 'cashapp', handle: 'alice-c' });
  });

  it('does not strip other games when storage is read and written back', async () => {
    // SyncService.saveGame does loadGames -> replace one game -> saveGames, so a
    // lossy read damages every *untouched* game in the same write.
    const gameA = makeGame({
      id: 'gameA',
      players: [{ id: 'p1', name: 'Alice', preferredPayment: { method: 'venmo', handle: 'a-h' } }],
    });
    const gameB = makeGame({ id: 'gameB', players: [{ id: 'p2', name: 'Bob' }] });
    await StorageService.saveGames([gameA, gameB]);

    const current = await StorageService.loadGames();
    const editedB = { ...gameB, name: 'Saturday' };
    await StorageService.saveGames(current.map(g => (g.id === 'gameB' ? editedB : g)));

    const loadedA = (await StorageService.loadGames()).find(g => g.id === 'gameA')!;
    expect(loadedA.players[0].preferredPayment).toEqual({ method: 'venmo', handle: 'a-h' });
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
