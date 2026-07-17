import {
  Game,
  Transaction,
  Player,
  PlayerBalance,
  GameSummary,
  SettlementMeta,
  Validation,
  SettlementResult,
} from '@/types/game';
import { calculateOptimalSettlements, validateSettlements } from './settlementService';
import { hashTransactions } from '@/utils/hashUtils';

export class GameService {
  static calculateBalances(game: Game): PlayerBalance[] {
    const balances: Map<string, PlayerBalance> = new Map();
    
    game.players.forEach(player => {
      balances.set(player.id, {
        playerId: player.id,
        playerName: player.name,
        totalBuyins: 0,
        totalCashouts: 0,
        netBalance: 0
      });
    });
    
    game.transactions.forEach(transaction => {
      const balance = balances.get(transaction.playerId);
      if (balance) {
        if (transaction.type === 'buyin') {
          balance.totalBuyins += transaction.amount;
          balance.netBalance -= transaction.amount;
        } else {
          balance.totalCashouts += transaction.amount;
          balance.netBalance += transaction.amount;
        }
      }
    });

    return Array.from(balances.values());
  }
  
  static generateGameSummary(game: Game): GameSummary {
    const balances = this.calculateBalances(game);
    const settlements = calculateOptimalSettlements(balances);
    const totalPot = balances.reduce((sum, b) => sum + b.totalBuyins, 0);
    const settlementMeta: SettlementMeta = {
      algorithm: 'client-greedy-v1',
      source: 'client',
      generatedAt: new Date().toISOString(),
    };

    return {
      game,
      balances,
      settlements,
      totalPot,
      settlementMeta,
    };
  }
  
  static addTransaction(
    game: Game,
    playerId: string,
    type: 'buyin' | 'cashout',
    amount: number
  ): Transaction {
    const transaction: Transaction = {
      id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      playerId,
      type,
      amount,
      timestamp: new Date()
    };
    
    game.transactions.push(transaction);
    return transaction;
  }

  static setPlayerTransactionTotal(
    game: Game,
    playerId: string,
    type: 'buyin' | 'cashout',
    totalAmount: number
  ): Transaction | null {
    // Clear settlement cache when modifying completed games
    if (game.status === 'completed') {
      this.clearSettlementCache(game);
    }

    const filteredTransactions = game.transactions.filter(
      transaction => !(transaction.playerId === playerId && transaction.type === type)
    );

    game.transactions.length = 0;
    game.transactions.push(...filteredTransactions);

    if (totalAmount <= 0) {
      return null;
    }

    const transaction: Transaction = {
      id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      playerId,
      type,
      amount: totalAmount,
      timestamp: new Date()
    };

    game.transactions.push(transaction);
    return transaction;
  }
  
  static addPlayer(game: Game, name: string): Player {
    const player: Player = {
      id: `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
    };

    game.players.push(player);
    return player;
  }

  static removePlayer(game: Game, playerId: string): void {
    // Clear settlement cache when modifying completed games
    if (game.status === 'completed') {
      this.clearSettlementCache(game);
    }

    // Remove player from players array
    game.players = game.players.filter(player => player.id !== playerId);

    // Cascade delete: remove all transactions for this player
    game.transactions = game.transactions.filter(
      transaction => transaction.playerId !== playerId
    );

    // If the removed player was the designated banker, fall back to optimal
    // mode rather than leaving a dangling bankerPlayerId pointing at nobody.
    if (game.bankerPlayerId === playerId) {
      game.settlementMode = 'optimal';
      game.bankerPlayerId = undefined;
      this.clearSettlementCache(game);
    }
  }

  /**
   * Switch settlement mode. In 'optimal' (Direct) mode the remembered
   * bankerPlayerId is RETAINED so toggling back to banker is one tap. In
   * 'banker' mode, pass bankerId to (re)assign the banker; omit it to keep the
   * remembered one. Invariant: callers must not enter 'banker' mode without a
   * valid banker — use hasRememberedBanker() to decide whether to prompt first.
   */
  static setSettlementMode(
    game: Game,
    mode: 'optimal' | 'banker',
    bankerId?: string,
  ): void {
    game.settlementMode = mode;
    if (mode === 'banker' && bankerId) {
      game.bankerPlayerId = bankerId;
    }
    this.clearSettlementCache(game);
  }

  /** True when a valid banker is remembered (id set and still in the roster). */
  static hasRememberedBanker(game: Game): boolean {
    return (
      !!game.bankerPlayerId &&
      game.players.some(p => p.id === game.bankerPlayerId)
    );
  }

  /**
   * Mark a player as completed (left the game)
   * Clears settlement cache if game is completed
   */
  static markPlayerAsCompleted(game: Game, playerId: string): void {
    // Clear settlement cache when modifying completed games
    if (game.status === 'completed') {
      this.clearSettlementCache(game);
    }

    const player = game.players.find(p => p.id === playerId);
    if (player) {
      player.completedAt = new Date();
    }
  }

  /**
   * Reactivate a completed player (return to active status)
   * Clears settlement cache if game is completed
   */
  static markPlayerAsActive(game: Game, playerId: string): void {
    // Clear settlement cache when modifying completed games
    if (game.status === 'completed') {
      this.clearSettlementCache(game);
    }

    const player = game.players.find(p => p.id === playerId);
    if (player) {
      delete player.completedAt;
    }
  }

  /**
   * Rename a player
   * Deliberately does NOT clear settlement cache — name is cosmetic and
   * does not affect settlement calculations (hash is transaction-based).
   */
  static renamePlayer(game: Game, playerId: string, newName: string): void {
    const index = game.players.findIndex(p => p.id === playerId);
    if (index !== -1) {
      game.players[index] = { ...game.players[index], name: newName };
    }
  }

  static validateGame(
    balances: PlayerBalance[],
    formatMoney?: (n: number) => string,
    bankerPlayerId?: string,
    settlementMode?: 'optimal' | 'banker',
    tolerance?: number,
  ): Validation {
    return validateSettlements(balances, formatMoney, bankerPlayerId, settlementMode, tolerance);
  }
  
  static completeGame(game: Game): void {
    game.status = 'completed';
  }
  
  static createGame(
    name: string,
    defaults?: { cashUnit?: number; settlementMode?: 'optimal' | 'banker' },
  ): Game {
    const game: Game = {
      id: `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      date: new Date(),
      status: 'active',
      players: [],
      transactions: [],
      createdAt: new Date(),
    };
    // Seed only when a default is defined so an unset default preserves the
    // existing lazy-fallback behavior (cashUnit resolves to the currency note;
    // settlementMode absent is treated as 'optimal').
    if (defaults?.cashUnit !== undefined) game.cashUnit = defaults.cashUnit;
    if (defaults?.settlementMode !== undefined) game.settlementMode = defaults.settlementMode;
    return game;
  }

  /**
   * Cache settlement result in game object
   * Updates transaction hash for invalidation detection
   */
  static cacheSettlements(game: Game, settlementResult: SettlementResult): void {
    game.cachedSettlements = settlementResult;
    game.transactionHash = hashTransactions(game.transactions);
  }

  /**
   * Check if cached settlements are still valid
   * Returns cached result if valid, null if invalid or missing
   */
  static getCachedSettlements(game: Game): SettlementResult | null {
    if (!game.cachedSettlements || !game.transactionHash) {
      return null;
    }

    const currentHash = hashTransactions(game.transactions);
    if (currentHash !== game.transactionHash) {
      console.warn('[cache] Settlement cache invalidated - transactions changed');
      return null;
    }

    return game.cachedSettlements;
  }

  /**
   * Clear settlement cache (e.g., when game data changes)
   */
  static clearSettlementCache(game: Game): void {
    game.cachedSettlements = undefined;
    game.transactionHash = undefined;
  }
}
