import { Game, Transaction, Player, PlayerBalance, GameSummary, Validation } from '@/types/game';
import { calculateOptimalSettlements, validateSettlements } from './settlementService';

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

    return {
      game,
      balances,
      settlements,
      totalPot
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
  
  static addPlayer(game: Game, name: string): Player {
    const player: Player = {
      id: `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      createdAt: new Date()
    };
    
    game.players.push(player);
    return player;
  }
  
  static validateGame(balances: PlayerBalance[]): Validation {
    return validateSettlements(balances);
  }
  
  static completeGame(game: Game): void {
    game.status = 'completed';
    game.completedAt = new Date();
  }
  
  static createGame(name: string): Game {
    return {
      id: `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      date: new Date(),
      status: 'active',
      players: [],
      transactions: [],
      createdAt: new Date()
    };
  }
}
