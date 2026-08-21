export type PaymentMethod =
  | 'cash' | 'venmo' | 'paypal' | 'cashapp' | 'zelle' | 'applecash' | 'other';

export interface PreferredPayment {
  method: PaymentMethod;
  handle?: string;
}

/**
 * Bare payment handles keyed by method. A key present with '' means the method is
 * selected with no handle — a real, reachable state that shareMessage.ts renders as
 * a label with no handle ("label when it informs").
 */
export type PaymentHandles = Partial<Record<PaymentMethod, string>>;

/** The two payment fields carried by both Player and SavedPlayer. */
export interface PaymentCarrier {
  methods?: PaymentHandles;
  defaultMethod?: PaymentMethod;
}

export interface Player {
  id: string;
  name: string;
  completedAt?: Date;
  preferredPayment?: PreferredPayment;
  methods?: PaymentHandles;
  defaultMethod?: PaymentMethod;
  /** The saved-pool entry (by id) that seeded this player, so mid-game payment edits
   *  write back to the right saved player. Undefined for players typed with no match. */
  savedPlayerId?: string;
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

  /** Currency the game was created in (defaults to user preference at game time) */
  currency?: string;

  /** Cash rounding unit in the game's currency. Default 5. 0 (or <=0) = Exact (no rounding). */
  cashUnit?: number;

  /** Buy-in vs cash-out imbalance tolerance, in the game's native currency
   *  units. Absent = resolve to the currency default (see resolveTolerance). */
  imbalanceTolerance?: number;

  /** Settlement mode. Absent = 'optimal' (peer-to-peer solver). 'banker' = star through bankerPlayerId. */
  settlementMode?: 'optimal' | 'banker';

  /**
   * The player acting as banker/hub. Required to COMPLETE a game in
   * settlementMode === 'banker', but may legitimately be absent while in banker
   * mode — either a new game seeded from a Banker default, or an existing one
   * whose banker player was removed. validateSettlements() gates completion
   * until one is chosen. May also persist while settlementMode === 'optimal' as
   * the remembered choice, so toggling back to banker is one tap. Cleared when
   * that player is removed.
   */
  bankerPlayerId?: string;

  /** Default buy-in auto-applied when adding players, in the game's native
   *  currency units. Absent or 0 = off (the Add Player modal shows the manual
   *  Buy-In field). Stamped at creation from the user's global default;
   *  editable per game. Changing it affects subsequent adds only. */
  defaultBuyIn?: number;

  // Settlement cache
  cachedSettlements?: SettlementResult;
  transactionHash?: string;

  /** True once this game has been counted toward profile stats (set on first
   *  completion). Guards against double-counting when a game is reopened and
   *  re-completed. Absent on games completed before this feature. */
  statsCounted?: boolean;

  /** The /sharedGames document this game was last published to, if any. Present
   *  so a re-share REFRESHES the link already sitting in a group chat instead of
   *  minting a second one beside a stale first. 20 chars, [A-Za-z0-9]. */
  shareId?: string;

  /** True once a /sharedGames write for this game has been ACKNOWLEDGED by the
   *  backend. NOT implied by shareId: the id is minted locally and persisted
   *  even when the write times out, so shareId proves only that an id exists.
   *  This is what makes it safe to include the link in a share whose write did
   *  not ack in time. Boolean, never a Date — StorageService.loadGames revives
   *  dates field by field and spreads the rest, so a Date here would return
   *  from AsyncStorage as an ISO string typed as Date. */
  shareAcked?: boolean;

  // Cloud sync — set by Firestore serverTimestamp on each write
  syncedAt?: Date;
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

export type SettlementSource = 'server' | 'client';

export interface SettlementMeta {
  algorithm: string;
  source: SettlementSource;
  generatedAt: string;
  serverRequestId?: string;
  warnings?: string[];
  error?: string;
}

export interface SettlementResult extends SettlementMeta {
  settlements: Settlement[];
}

export interface SettlementRequestSettings {
  maxTransfersPerPlayer?: number;
  minTransferAmount?: number;
  /** Forwarded to the solver. Default 5. <= 0 = Exact (no rounding). */
  cashRoundingUnit?: number;
  /** Imbalance tolerance forwarded to the solver, native units. Default 2.50. */
  imbalanceTolerance?: number;
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
  settlementMeta: SettlementMeta;
}
