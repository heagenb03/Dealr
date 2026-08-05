/**
 * Tier limits for players-per-game and game history, plus the pure predicates
 * that apply them. Saved-player caps deliberately live in `savedPlayersService`
 * beside the gate function that guards them — do not move them here.
 */

/** Free tier: max players per game. */
export const FREE_PLAYER_CAP = 12;

/**
 * Pro tier: max players per game.
 *
 * MUST stay at or below the DEPLOYED `firestore.rules` ceiling.
 *   Deployed today: `players.size() <= 20`.
 *   Target after the rules deploy: `players.size() <= 100`.
 *
 * Until that deploy lands, this constant (50) EXCEEDS the live rule. That is
 * intentional and safe ONLY because no build carrying it has been released —
 * the app is offline-first, so an over-rule game still saves to AsyncStorage
 * and only its Firestore sync fails. Verify the DEPLOYED rule before shipping.
 *
 * Once the rule is at 100 the app cap sits deliberately below it, so this number
 * can rise again without a rules deploy; the rule remains the storage-abuse guard.
 *
 * A game past the RULE fails its Firestore write with permission-denied, which is
 * not an offline error, so the fire-and-forget write only logs a console warning
 * and the game never leaves the device while appearing saved.
 *
 * DO NOT raise this above the DEPLOYED rule without raising and DEPLOYING the
 * rule first.
 *
 * 50 is measured, not guessed: over 8 seeds the MILP returns 12.6% fewer payments
 * than the greedy fallback at N=50 versus 10.5% at N=12, solve latency is flat at
 * ~6s from N=20 to N=50, and a 50-player document is 5.5% of Firestore's 1 MiB
 * limit.
 */
export const PRO_PLAYER_CAP = 50;

/** Free tier: completed games shown in history. Display only — never a data limit. */
export const FREE_HISTORY_LIMIT = 10;

/** The effective players-per-game cap for a tier. */
export function playerCapFor(isPro: boolean): number {
  return isPro ? PRO_PLAYER_CAP : FREE_PLAYER_CAP;
}

/**
 * Whether another player can be added at this count. Gates on count vs the tier
 * cap, never on tier alone — free users may add until their own cap is full.
 */
export function canAddMorePlayers(count: number, isPro: boolean): boolean {
  return count < playerCapFor(isPro);
}

/**
 * Splits completed games into the display slice and a hidden count.
 *
 * Display only: the source array is never mutated and nothing is removed from
 * storage or sync. A free user over the limit keeps every game, and they all
 * reappear on upgrade.
 */
export function splitCompletedHistory<T>(
  completed: T[],
  isPro: boolean,
): { visible: T[]; hiddenCount: number } {
  if (isPro) return { visible: completed, hiddenCount: 0 };
  return {
    visible: completed.slice(0, FREE_HISTORY_LIMIT),
    hiddenCount: Math.max(0, completed.length - FREE_HISTORY_LIMIT),
  };
}
