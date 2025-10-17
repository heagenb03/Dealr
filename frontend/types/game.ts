// Core type definitions for the poker tracking app

export interface Player {
  id: string;
  name: string;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  playerId: string;
  type: 'buyin' | 'cashout';
  amount: number;
  timestamp: Date;
}

export interface Game {
  id: string;
  name: string;
  date: Date;
  status: 'active' | 'completed';
  players: Player[];
  transactions: Transaction[];
  createdAt: Date;
  completedAt?: Date;
}

export interface PlayerBalance {
  playerId: string;
  playerName: string;
  totalBuyins: number;
  totalCashouts: number;
  netBalance: number;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
}

export interface Validation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  totalBuyins: number;
  totalCashouts: number;
  netDifference: number;
}

export interface GameSummary {
  game: Game;
  balances: PlayerBalance[];
  settlements: Settlement[];
  totalPot: number;
}
