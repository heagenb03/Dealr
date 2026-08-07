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
 * Body of the native Alert.alert('Player Limit', …) calls in active.tsx (:561, :788),
 * where the fuller sentence reads better and width is not constrained.
 *
 * NOT used in the Add Players modal any more — that is playerCapBanner below, which is
 * fitted to the card's ~257pt usable width. Three cases: Pro at cap (newly reachable),
 * free over cap, free at cap.
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

/**
 * Two lines at ~39 chars/line: ~257pt usable card width, 13pt system sans
 * (avg advance ≈ 0.5em). Pinned by a test — a third line would push the banner
 * over the last saved row it floats above.
 */
export const PLAYER_CAP_BANNER_MAX_CHARS = 78;

/**
 * One line: ~235pt after the lock icon and its gap, SpaceMono 13pt (advance 0.6em).
 * The notice renders with numberOfLines={1}, so exceeding this truncates silently.
 */
export const SAVED_CAP_NOTICE_MAX_CHARS = 30;

/**
 * Player-cap message inside the Add Players modal — both the floating banner and its
 * in-flow fallback. Terser than playerCapHint because it must fit two lines over a
 * live saved-player row.
 *
 * The grandfathered framing of the over-cap branch ("13 in this game · free adds 12")
 * is deliberate: a user whose trial lapsed while holding more than the free cap must
 * never be shown a limit their own visible roster contradicts.
 */
export function playerCapBanner(count: number, isPro: boolean): string {
  if (isPro) {
    return `Maximum ${PRO_PLAYER_CAP} players per game.`;
  }
  if (count > FREE_PLAYER_CAP) {
    return `${count} in this game · free adds ${FREE_PLAYER_CAP} · Upgrade for ${PRO_PLAYER_CAP}`;
  }
  return `Free limit reached · ${FREE_PLAYER_CAP} players · Upgrade for ${PRO_PLAYER_CAP}`;
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

/**
 * "Full" notice inside the Add Players modal. Terser than the screen counter, and the
 * over-cap branches are terser still — they render on ONE line beside a lock icon
 * (numberOfLines={1}), so the longer "N saved, M max" phrasing truncated on a narrow
 * phone. Budget pinned by SAVED_CAP_NOTICE_MAX_CHARS.
 */
export function savedCapModalNotice(count: number, isPro: boolean): string {
  const cap = savedCapFor(isPro);
  if (count > cap) {
    return isPro
      ? `Saved full · ${count} of ${cap}`
      : `Saved full · ${count} of ${cap} free`;
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
