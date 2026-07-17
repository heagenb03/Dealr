import { GameService } from '../gameService';
import { Game, PlayerBalance, SettlementResult } from '@/types/game';

function createTestGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game_test',
    name: 'Test Game',
    date: new Date('2025-01-01'),
    status: 'active',
    players: [],
    transactions: [],
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

// ---- createGame ----

describe('GameService.createGame', () => {
  it('creates a game with the given name', () => {
    const game = GameService.createGame('Friday Night Poker');
    expect(game.name).toBe('Friday Night Poker');
  });

  it('creates a game with active status', () => {
    const game = GameService.createGame('Test');
    expect(game.status).toBe('active');
  });

  it('creates a game with empty players and transactions', () => {
    const game = GameService.createGame('Test');
    expect(game.players).toEqual([]);
    expect(game.transactions).toEqual([]);
  });

  it('generates a unique id starting with game_', () => {
    const game = GameService.createGame('Test');
    expect(game.id).toMatch(/^game_/);
  });

  it('sets date and createdAt', () => {
    const game = GameService.createGame('Test');
    expect(game.date).toBeInstanceOf(Date);
    expect(game.createdAt).toBeInstanceOf(Date);
  });

  it('leaves cashUnit and settlementMode undefined when no defaults are given', () => {
    const game = GameService.createGame('Test');
    expect(game.cashUnit).toBeUndefined();
    expect(game.settlementMode).toBeUndefined();
  });

  it('seeds cashUnit from defaults when provided', () => {
    const game = GameService.createGame('Test', { cashUnit: 0 });
    expect(game.cashUnit).toBe(0);
  });

  it('seeds settlementMode from defaults when provided', () => {
    const game = GameService.createGame('Test', { settlementMode: 'banker' });
    expect(game.settlementMode).toBe('banker');
  });

  it('ignores undefined fields inside defaults', () => {
    const game = GameService.createGame('Test', { cashUnit: undefined, settlementMode: undefined });
    expect(game.cashUnit).toBeUndefined();
    expect(game.settlementMode).toBeUndefined();
  });
});

// ---- addPlayer ----

describe('GameService.addPlayer', () => {
  it('adds a player to the game', () => {
    const game = createTestGame();
    GameService.addPlayer(game, 'Alice');
    expect(game.players).toHaveLength(1);
  });

  it('returns a player with the correct name', () => {
    const game = createTestGame();
    const player = GameService.addPlayer(game, 'Bob');
    expect(player.name).toBe('Bob');
  });

  it('generates a unique player id starting with player_', () => {
    const game = createTestGame();
    const player = GameService.addPlayer(game, 'Alice');
    expect(player.id).toMatch(/^player_/);
  });

  it('leaves completedAt undefined for new players', () => {
    const game = createTestGame();
    const player = GameService.addPlayer(game, 'Alice');
    expect(player.completedAt).toBeUndefined();
  });
});

// ---- removePlayer ----

describe('GameService.removePlayer', () => {
  it('removes the player from the game', () => {
    const game = createTestGame();
    const player = GameService.addPlayer(game, 'Alice');
    GameService.removePlayer(game, player.id);
    expect(game.players).toHaveLength(0);
  });

  it('removes transactions belonging to the removed player', () => {
    const game = createTestGame();
    const alice = GameService.addPlayer(game, 'Alice');
    const bob = GameService.addPlayer(game, 'Bob');
    GameService.addTransaction(game, alice.id, 'buyin', 100);
    GameService.addTransaction(game, bob.id, 'buyin', 50);

    GameService.removePlayer(game, alice.id);
    expect(game.transactions).toHaveLength(1);
    expect(game.transactions[0].playerId).toBe(bob.id);
  });

  it('clears settlement cache on completed game', () => {
    const game = createTestGame({ status: 'completed' });
    const player = GameService.addPlayer(game, 'Alice');
    game.cachedSettlements = { settlements: [], algorithm: 'test', source: 'client', generatedAt: '' };
    game.transactionHash = 'abc';

    GameService.removePlayer(game, player.id);
    expect(game.cachedSettlements).toBeUndefined();
    expect(game.transactionHash).toBeUndefined();
  });

  it('does not clear cache on active game', () => {
    const game = createTestGame({ status: 'active' });
    const player = GameService.addPlayer(game, 'Alice');
    game.cachedSettlements = { settlements: [], algorithm: 'test', source: 'client', generatedAt: '' };
    game.transactionHash = 'abc';

    GameService.removePlayer(game, player.id);
    expect(game.cachedSettlements).toBeDefined();
  });

  it('resets banker mode to optimal when the removed player is the designated banker', () => {
    const game = createTestGame({ status: 'active' });
    const banker = GameService.addPlayer(game, 'Bank');
    game.settlementMode = 'banker';
    game.bankerPlayerId = banker.id;
    game.cachedSettlements = { settlements: [], algorithm: 'test', source: 'client', generatedAt: '' };
    game.transactionHash = 'abc';

    GameService.removePlayer(game, banker.id);

    expect(game.settlementMode).toBe('optimal');
    expect(game.bankerPlayerId).toBeUndefined();
    expect(game.cachedSettlements).toBeUndefined();
    expect(game.transactionHash).toBeUndefined();
  });

  it('leaves banker mode untouched when the removed player is not the banker', () => {
    const game = createTestGame({ status: 'active' });
    const banker = GameService.addPlayer(game, 'Bank');
    const other = GameService.addPlayer(game, 'Alice');
    game.settlementMode = 'banker';
    game.bankerPlayerId = banker.id;

    GameService.removePlayer(game, other.id);

    expect(game.settlementMode).toBe('banker');
    expect(game.bankerPlayerId).toBe(banker.id);
  });
});

// ---- setPlayerTransactionTotal ----

describe('GameService.setPlayerTransactionTotal', () => {
  it('replaces existing transaction of the same type', () => {
    const game = createTestGame();
    const player = GameService.addPlayer(game, 'Alice');
    GameService.addTransaction(game, player.id, 'buyin', 50);

    GameService.setPlayerTransactionTotal(game, player.id, 'buyin', 100);
    const buyins = game.transactions.filter(
      t => t.playerId === player.id && t.type === 'buyin'
    );
    expect(buyins).toHaveLength(1);
    expect(buyins[0].amount).toBe(100);
  });

  it('removes transaction when amount is zero', () => {
    const game = createTestGame();
    const player = GameService.addPlayer(game, 'Alice');
    GameService.addTransaction(game, player.id, 'buyin', 50);

    const result = GameService.setPlayerTransactionTotal(game, player.id, 'buyin', 0);
    expect(result).toBeNull();
    const buyins = game.transactions.filter(
      t => t.playerId === player.id && t.type === 'buyin'
    );
    expect(buyins).toHaveLength(0);
  });

  it('removes transaction when amount is negative', () => {
    const game = createTestGame();
    const player = GameService.addPlayer(game, 'Alice');
    GameService.addTransaction(game, player.id, 'buyin', 50);

    const result = GameService.setPlayerTransactionTotal(game, player.id, 'buyin', -10);
    expect(result).toBeNull();
  });

  it('clears settlement cache on completed game', () => {
    const game = createTestGame({ status: 'completed' });
    const player = GameService.addPlayer(game, 'Alice');
    game.cachedSettlements = { settlements: [], algorithm: 'test', source: 'client', generatedAt: '' };
    game.transactionHash = 'abc';

    GameService.setPlayerTransactionTotal(game, player.id, 'buyin', 100);
    expect(game.cachedSettlements).toBeUndefined();
  });

  it('does not affect transactions of other players', () => {
    const game = createTestGame();
    const alice = GameService.addPlayer(game, 'Alice');
    const bob = GameService.addPlayer(game, 'Bob');
    GameService.addTransaction(game, alice.id, 'buyin', 50);
    GameService.addTransaction(game, bob.id, 'buyin', 75);

    GameService.setPlayerTransactionTotal(game, alice.id, 'buyin', 100);
    const bobBuyins = game.transactions.filter(
      t => t.playerId === bob.id && t.type === 'buyin'
    );
    expect(bobBuyins).toHaveLength(1);
    expect(bobBuyins[0].amount).toBe(75);
  });
});

// ---- calculateBalances ----

describe('GameService.calculateBalances', () => {
  it('returns zero balances for players with no transactions', () => {
    const game = createTestGame();
    GameService.addPlayer(game, 'Alice');

    const balances = GameService.calculateBalances(game);
    expect(balances).toHaveLength(1);
    expect(balances[0].totalBuyins).toBe(0);
    expect(balances[0].totalCashouts).toBe(0);
    expect(balances[0].netBalance).toBe(0);
  });

  it('calculates negative net balance for buyins only', () => {
    const game = createTestGame();
    const alice = GameService.addPlayer(game, 'Alice');
    GameService.addTransaction(game, alice.id, 'buyin', 100);

    const balances = GameService.calculateBalances(game);
    expect(balances[0].totalBuyins).toBe(100);
    expect(balances[0].totalCashouts).toBe(0);
    expect(balances[0].netBalance).toBe(-100);
  });

  it('calculates net balance as cashouts minus buyins', () => {
    const game = createTestGame();
    const alice = GameService.addPlayer(game, 'Alice');
    GameService.addTransaction(game, alice.id, 'buyin', 100);
    GameService.addTransaction(game, alice.id, 'cashout', 150);

    const balances = GameService.calculateBalances(game);
    expect(balances[0].totalBuyins).toBe(100);
    expect(balances[0].totalCashouts).toBe(150);
    expect(balances[0].netBalance).toBe(50);
  });

  it('handles multiple players', () => {
    const game = createTestGame();
    const alice = GameService.addPlayer(game, 'Alice');
    const bob = GameService.addPlayer(game, 'Bob');
    GameService.addTransaction(game, alice.id, 'buyin', 100);
    GameService.addTransaction(game, alice.id, 'cashout', 60);
    GameService.addTransaction(game, bob.id, 'buyin', 100);
    GameService.addTransaction(game, bob.id, 'cashout', 140);

    const balances = GameService.calculateBalances(game);
    const aliceBalance = balances.find(b => b.playerName === 'Alice')!;
    const bobBalance = balances.find(b => b.playerName === 'Bob')!;

    expect(aliceBalance.netBalance).toBe(-40);
    expect(bobBalance.netBalance).toBe(40);
  });

  it('ignores transactions for non-existent players', () => {
    const game = createTestGame({
      transactions: [
        {
          id: 'txn_orphan',
          playerId: 'nonexistent',
          type: 'buyin',
          amount: 999,
          timestamp: new Date(),
        },
      ],
    });
    GameService.addPlayer(game, 'Alice');

    const balances = GameService.calculateBalances(game);
    expect(balances).toHaveLength(1);
    expect(balances[0].totalBuyins).toBe(0);
  });
});

// ---- completeGame ----

describe('GameService.completeGame', () => {
  it('sets status to completed', () => {
    const game = createTestGame();
    GameService.completeGame(game);
    expect(game.status).toBe('completed');
  });

  it('does not add extra properties to the game', () => {
    const game = createTestGame();
    const keysBefore = Object.keys(game);
    GameService.completeGame(game);
    // status is updated in-place, no new keys should be added
    expect(Object.keys(game)).toEqual(keysBefore);
  });
});

// ---- generateGameSummary ----

describe('GameService.generateGameSummary', () => {
  it('returns a summary with balances, settlements, and totalPot', () => {
    const game = createTestGame();
    const alice = GameService.addPlayer(game, 'Alice');
    const bob = GameService.addPlayer(game, 'Bob');
    GameService.addTransaction(game, alice.id, 'buyin', 100);
    GameService.addTransaction(game, bob.id, 'buyin', 100);
    GameService.addTransaction(game, alice.id, 'cashout', 60);
    GameService.addTransaction(game, bob.id, 'cashout', 140);

    const summary = GameService.generateGameSummary(game);
    expect(summary.game).toBe(game);
    expect(summary.balances).toHaveLength(2);
    expect(summary.totalPot).toBe(200);
    expect(summary.settlements.length).toBeGreaterThan(0);
    expect(summary.settlementMeta.algorithm).toBe('client-greedy-v1');
    expect(summary.settlementMeta.source).toBe('client');
  });
});

// ---- markPlayerAsCompleted / markPlayerAsActive ----

describe('GameService.markPlayerAsCompleted', () => {
  it('sets completedAt on the player', () => {
    const game = createTestGame();
    const player = GameService.addPlayer(game, 'Alice');
    GameService.markPlayerAsCompleted(game, player.id);
    expect(game.players[0].completedAt).toBeInstanceOf(Date);
  });

  it('clears settlement cache on completed game', () => {
    const game = createTestGame({ status: 'completed' });
    const player = GameService.addPlayer(game, 'Alice');
    game.cachedSettlements = { settlements: [], algorithm: 'test', source: 'client', generatedAt: '' };
    game.transactionHash = 'abc';

    GameService.markPlayerAsCompleted(game, player.id);
    expect(game.cachedSettlements).toBeUndefined();
  });

  it('does nothing for nonexistent player id', () => {
    const game = createTestGame();
    GameService.addPlayer(game, 'Alice');
    GameService.markPlayerAsCompleted(game, 'nonexistent');
    expect(game.players[0].completedAt).toBeUndefined();
  });
});

describe('GameService.markPlayerAsActive', () => {
  it('clears completedAt on the player', () => {
    const game = createTestGame();
    const player = GameService.addPlayer(game, 'Alice');
    GameService.markPlayerAsCompleted(game, player.id);
    GameService.markPlayerAsActive(game, player.id);
    expect(game.players[0].completedAt).toBeUndefined();
  });

  it('clears settlement cache on completed game', () => {
    const game = createTestGame({ status: 'completed' });
    const player = GameService.addPlayer(game, 'Alice');
    game.cachedSettlements = { settlements: [], algorithm: 'test', source: 'client', generatedAt: '' };
    game.transactionHash = 'abc';

    GameService.markPlayerAsActive(game, player.id);
    expect(game.cachedSettlements).toBeUndefined();
  });
});

// ---- renamePlayer ----

describe('GameService.renamePlayer', () => {
  it('renames the player', () => {
    const game = createTestGame();
    const player = GameService.addPlayer(game, 'Alice');
    GameService.renamePlayer(game, player.id, 'Alicia');
    expect(game.players[0].name).toBe('Alicia');
  });

  it('does not clear settlement cache', () => {
    const game = createTestGame({ status: 'completed' });
    const player = GameService.addPlayer(game, 'Alice');
    game.cachedSettlements = { settlements: [], algorithm: 'test', source: 'client', generatedAt: '' };
    game.transactionHash = 'abc';

    GameService.renamePlayer(game, player.id, 'Alicia');
    expect(game.cachedSettlements).toBeDefined();
    expect(game.transactionHash).toBe('abc');
  });

  it('does nothing for nonexistent player id', () => {
    const game = createTestGame();
    GameService.addPlayer(game, 'Alice');
    GameService.renamePlayer(game, 'nonexistent', 'Bob');
    expect(game.players[0].name).toBe('Alice');
  });
});

// ---- validateGame ----

describe('GameService.validateGame', () => {
  it('delegates to settlementService.validateSettlements', () => {
    const balances: PlayerBalance[] = [
      { playerId: 'p1', playerName: 'Alice', totalBuyins: 100, totalCashouts: 100, netBalance: 0 },
    ];
    const result = GameService.validateGame(balances);
    expect(result.isValid).toBe(true);
  });

  it('blocks banker mode when no banker is chosen', () => {
    const balances: PlayerBalance[] = [
      { playerId: 'p1', playerName: 'Alice', totalBuyins: 100, totalCashouts: 100, netBalance: 0 },
    ];
    const result = GameService.validateGame(balances, undefined, undefined, 'banker');
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/banker/i);
  });

  it('blocks banker mode when the banker id is not in the roster', () => {
    const balances: PlayerBalance[] = [
      { playerId: 'p1', playerName: 'Alice', totalBuyins: 100, totalCashouts: 100, netBalance: 0 },
    ];
    const result = GameService.validateGame(balances, undefined, 'ghost', 'banker');
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/banker/i);
  });

  it('allows banker mode when a valid banker (zero activity) is chosen', () => {
    const balances: PlayerBalance[] = [
      { playerId: 'p1', playerName: 'Alice', totalBuyins: 100, totalCashouts: 100, netBalance: 0 },
      { playerId: 'bank', playerName: 'Banker', totalBuyins: 0, totalCashouts: 0, netBalance: 0 },
    ];
    const result = GameService.validateGame(balances, undefined, 'bank', 'banker');
    expect(result.isValid).toBe(true);
  });
});

// ---- cacheSettlements / getCachedSettlements / clearSettlementCache ----

describe('GameService settlement cache', () => {
  it('stores and retrieves cached settlements', () => {
    const game = createTestGame();
    const alice = GameService.addPlayer(game, 'Alice');
    GameService.addTransaction(game, alice.id, 'buyin', 100);

    const settlementResult: SettlementResult = {
      settlements: [{ from: 'Alice', to: 'Bob', amount: 100 }],
      algorithm: 'server-milp-v1',
      source: 'server',
      generatedAt: '2025-01-01',
    };

    GameService.cacheSettlements(game, settlementResult);
    const cached = GameService.getCachedSettlements(game);
    expect(cached).not.toBeNull();
    expect(cached!.settlements).toHaveLength(1);
    expect(cached!.algorithm).toBe('server-milp-v1');
  });

  it('returns null when no cache exists', () => {
    const game = createTestGame();
    expect(GameService.getCachedSettlements(game)).toBeNull();
  });

  it('returns null when transactionHash is undefined', () => {
    const game = createTestGame();
    game.cachedSettlements = {
      settlements: [],
      algorithm: 'test',
      source: 'client',
      generatedAt: '',
    };
    // transactionHash not set
    expect(GameService.getCachedSettlements(game)).toBeNull();
  });

  it('invalidates cache when transactions change', () => {
    const game = createTestGame();
    const alice = GameService.addPlayer(game, 'Alice');
    GameService.addTransaction(game, alice.id, 'buyin', 100);

    const settlementResult: SettlementResult = {
      settlements: [{ from: 'Alice', to: 'Bob', amount: 100 }],
      algorithm: 'test',
      source: 'client',
      generatedAt: '',
    };

    GameService.cacheSettlements(game, settlementResult);
    // Modify transactions after caching
    GameService.addTransaction(game, alice.id, 'cashout', 50);

    const cached = GameService.getCachedSettlements(game);
    expect(cached).toBeNull();
  });

  it('clearSettlementCache removes cache', () => {
    const game = createTestGame();
    game.cachedSettlements = {
      settlements: [],
      algorithm: 'test',
      source: 'client',
      generatedAt: '',
    };
    game.transactionHash = 'abc';

    GameService.clearSettlementCache(game);
    expect(game.cachedSettlements).toBeUndefined();
    expect(game.transactionHash).toBeUndefined();
  });
});

// ---- setSettlementMode / hasRememberedBanker ----

describe('GameService.setSettlementMode', () => {
  it('retains bankerPlayerId when switching to optimal (Direct)', () => {
    const game = createTestGame({ settlementMode: 'banker', bankerPlayerId: 'p1' });
    GameService.setSettlementMode(game, 'optimal');
    expect(game.settlementMode).toBe('optimal');
    expect(game.bankerPlayerId).toBe('p1'); // remembered, NOT cleared
  });

  it('assigns bankerPlayerId when entering banker mode with an id', () => {
    const game = createTestGame({ settlementMode: 'optimal' });
    GameService.setSettlementMode(game, 'banker', 'p2');
    expect(game.settlementMode).toBe('banker');
    expect(game.bankerPlayerId).toBe('p2');
  });

  it('keeps the remembered banker when entering banker mode without an id', () => {
    const game = createTestGame({ settlementMode: 'optimal', bankerPlayerId: 'p3' });
    GameService.setSettlementMode(game, 'banker');
    expect(game.settlementMode).toBe('banker');
    expect(game.bankerPlayerId).toBe('p3');
  });
});

describe('GameService.hasRememberedBanker', () => {
  it('is false when no bankerPlayerId is set', () => {
    const game = createTestGame({ players: [{ id: 'p1', name: 'A' }] });
    expect(GameService.hasRememberedBanker(game)).toBe(false);
  });

  it('is false when the remembered banker is no longer in the roster', () => {
    const game = createTestGame({ bankerPlayerId: 'gone', players: [{ id: 'p1', name: 'A' }] });
    expect(GameService.hasRememberedBanker(game)).toBe(false);
  });

  it('is true when the remembered banker is still in the roster', () => {
    const game = createTestGame({ bankerPlayerId: 'p1', players: [{ id: 'p1', name: 'A' }] });
    expect(GameService.hasRememberedBanker(game)).toBe(true);
  });
});
