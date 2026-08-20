/**
 * The frozen projection a host writes to /sharedGames/{shareId}.
 *
 * This is NOT a copy of the Game doc. It is the minimum the summary screen
 * actually draws: no transactions, no player roster, no savedPlayerId. The
 * host's buy-in/cash-out history and saved-player linkage never leave the device.
 *
 * playerId DOES travel, on both the balances and the banker. That is forced, not
 * stylistic: buildSummaryListData reads balance.playerId for the non-playing-banker
 * hint and again for the React key. Player IDs are local UUIDs — meaningless off
 * the host's device, and they leak nothing.
 *
 * No react-native import — this stays unit-testable under jest-expo/node.
 */
import { Game, PlayerBalance, PreferredPayment, Settlement } from '@/types/game';
import {
  CurrencyCode,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
} from '@/constants/Currencies';

/**
 * Bumped only for a snapshot shape that older INSTALLED builds cannot render.
 * Installed builds are not upgradable on demand, so a future incompatible shape
 * must be gated on this and show "Update Cash Cage to view this game".
 */
export const SHARED_GAME_SCHEMA = 1;

export interface SharedGameSnapshot {
  gameName: string;
  date: Date;
  currency: CurrencyCode;
  /** ALREADY RESOLVED — see buildSharedGameSnapshot. Never the raw game field. */
  settlementMode: 'optimal' | 'banker';
  /** Present only in resolved banker mode. Renders the header subhead. */
  bankerName?: string;
  /** Present only in resolved banker mode. Feeds the non-playing-banker hint. */
  bankerPlayerId?: string;
  totalPot: number;
  balances: PlayerBalance[];
  settlements: Settlement[];
  /**
   * Keyed by player NAME, matching the paymentByName map summary.tsx already
   * builds and the name-based Settlement type. A plain object, not a Map:
   * Firestore cannot store a Map. paymentMapFromSnapshot is the adapter.
   */
  payments: Record<string, PreferredPayment>;
}

function resolveCurrency(code: string | undefined): CurrencyCode {
  // game.currency is typed `string`, so a stale doc can hold anything. An
  // unsupported code would make createCurrencyFormatters read
  // SUPPORTED_CURRENCIES[code] as undefined and throw on meta.locale.
  if (code && code in SUPPORTED_CURRENCIES) return code as CurrencyCode;
  return DEFAULT_CURRENCY;
}

export function buildSharedGameSnapshot(params: {
  game: Game;
  balances: PlayerBalance[];
  settlements: Settlement[];
  totalPot: number;
}): SharedGameSnapshot {
  const { game, balances, settlements, totalPot } = params;

  // THE RESOLVED MODE, not game.settlementMode. Since 2026-08-07 removePlayer
  // leaves 'banker' mode in place with no bankerPlayerId, and bankerPlayerId also
  // persists in optimal mode as the remembered choice. The snapshot omits
  // players[], so the viewer cannot re-derive this — it must be decided here.
  // Mirrors hasResolvedBanker in app/(tabs)/(home)/game/summary.tsx.
  const bankerPlayer =
    game.settlementMode === 'banker'
      ? game.players.find(p => p.id === game.bankerPlayerId)
      : undefined;

  const payments: Record<string, PreferredPayment> = {};
  for (const player of game.players) {
    const pref = player.preferredPayment;
    if (!pref) continue;
    // Build the entry field-by-field so an undefined handle is ABSENT rather
    // than present-and-undefined — Firestore rejects undefined values.
    payments[player.name] =
      pref.handle === undefined
        ? { method: pref.method }
        : { method: pref.method, handle: pref.handle };
  }

  return {
    gameName: game.name,
    date: game.date,
    currency: resolveCurrency(game.currency),
    settlementMode: bankerPlayer ? 'banker' : 'optimal',
    ...(bankerPlayer
      ? { bankerName: bankerPlayer.name, bankerPlayerId: bankerPlayer.id }
      : {}),
    totalPot,
    balances,
    settlements,
    payments,
  };
}

/** The Map<string, PreferredPayment> SummaryView takes, from the stored object. */
export function paymentMapFromSnapshot(
  snapshot: SharedGameSnapshot,
): Map<string, PreferredPayment> {
  return new Map(Object.entries(snapshot.payments ?? {}));
}
