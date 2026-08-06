import { FREE_PLAYER_CAP, PRO_PLAYER_CAP } from '@/utils/tierLimits';
import { FREE_SAVED_CAP, PRO_SAVED_CAP, savedCapFor } from '@/services/savedPlayersService';

/**
 * User-facing copy for tier caps.
 *
 * Every helper here handles `count > cap`, which is reachable whenever a trial
 * ends or a subscription lapses while the user holds more than the free tier
 * admits. That content is grandfathered (never removed), so the copy must not
 * state a cap the visible count contradicts.
 */

/** Shown when a free user is blocked from adding a player. */
export const PLAYERS_PAYWALL_MESSAGE = `Upgrade to Pro for up to ${PRO_PLAYER_CAP} players per game.`;

/**
 * Hint under the Add Players list when no more players can be added.
 * Three cases: Pro at cap (newly reachable), free over cap, free at cap.
 */
export function playerCapHint(count: number, isPro: boolean): string {
  if (isPro) {
    return `Maximum ${PRO_PLAYER_CAP} players per game.`;
  }
  if (count > FREE_PLAYER_CAP) {
    return `${count} players in this game. Upgrade to Pro for up to ${PRO_PLAYER_CAP}.`;
  }
  return `Free limit reached · ${FREE_PLAYER_CAP} players. Upgrade to Pro for up to ${PRO_PLAYER_CAP}.`;
}

/** Persistent counter at the top of the Saved Players screen. */
export function savedCapCounter(count: number, isPro: boolean): string {
  const cap = savedCapFor(isPro);
  if (isPro && count > cap) {
    return `${count} saved · ${cap} max`;
  }
  if (!isPro && count > cap) {
    return `${count} saved · Upgrade for ${PRO_SAVED_CAP}`;
  }
  if (!isPro && count >= cap) {
    return `${count} / ${cap} · Upgrade for ${PRO_SAVED_CAP}`;
  }
  return `${count} / ${cap} saved`;
}

/** "Full" notice inside the Add Players modal. Terser than the screen counter. */
export function savedCapModalNotice(count: number, isPro: boolean): string {
  const cap = savedCapFor(isPro);
  if (count > cap) {
    return isPro
      ? `Saved players full · ${count} saved, ${cap} max`
      : `Saved players full · ${count} saved, ${cap} on free`;
  }
  return `Saved players full · ${count}/${cap}`;
}

/** Paywall trigger message for the saved-players cap. */
export function savedCapPaywallMessage(count: number, isPro: boolean): string {
  const cap = savedCapFor(isPro);
  if (isPro) {
    return `You've reached the ${cap}-player limit. Delete some players to add more.`;
  }
  if (count > cap) {
    return `You've saved ${count} players. The free plan holds ${cap}, but you can upgrade to Pro to save up to ${PRO_SAVED_CAP}.`;
  }
  return `You've saved ${FREE_SAVED_CAP} players. Upgrade to Pro to save up to ${PRO_SAVED_CAP}.`;
}
