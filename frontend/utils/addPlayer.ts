import type { Player } from '@/types/game';
import type { SavedPlayer } from '@/services/savedPlayersService';

/** Trim + lowercase for case-insensitive name comparison. */
const norm = (name: string): string => name.trim().toLowerCase();

/**
 * True if any player already in the game (active OR completed) has this name,
 * compared trimmed + case-insensitively. Enforces game-wide unique names.
 */
export function isNameTakenInGame(players: Player[], name: string): boolean {
  const target = norm(name);
  if (!target) return false;
  return players.some(p => norm(p.name) === target);
}

/**
 * The in-game player whose name matches `name` (trimmed, case-insensitive), or null.
 * Searches active AND completed players, exactly like isNameTakenInGame.
 *
 * The find-one counterpart to isNameTakenInGame — they MUST agree, because a saved row's
 * "Added ✓" state comes from one and its undo target from the other. A divergence renders
 * an Undo control that does nothing when tapped, which is why they live side by side and
 * share `norm`.
 */
export function findPlayerByName(players: Player[], name: string): Player | null {
  const target = norm(name);
  if (!target) return null;
  return players.find(p => norm(p.name) === target) ?? null;
}

/**
 * Saved players whose name exactly equals `name` (trimmed, case-insensitive).
 * Saved names are unique, so this is normally 0 or 1; 2+ only for legacy data.
 */
export function matchSavedByExactName(saved: SavedPlayer[], name: string): SavedPlayer[] {
  const target = norm(name);
  if (!target) return [];
  return saved.filter(p => norm(p.name) === target);
}

/**
 * Saved players whose name contains `query` (trimmed, case-insensitive substring).
 * An empty query returns the same list reference (preserves input order).
 */
export function filterSavedByQuery(saved: SavedPlayer[], query: string): SavedPlayer[] {
  const q = norm(query);
  if (!q) return saved;
  return saved.filter(p => norm(p.name).includes(q));
}

/**
 * Slim in-modal confirmation label shown after adds. Returns null until at
 * least one player has been added (and a name is known), so the line only
 * appears once there is something to confirm. Excludes the ✓ glyph — the
 * caller renders that as styled prefix.
 */
export function formatAddedConfirmation(
  lastAddedName: string | null,
  count: number,
  amountLabel?: string | null,
): string | null {
  if (count < 1 || !lastAddedName) return null;
  const amount = amountLabel ? ` · ${amountLabel}` : '';
  return `Added ${lastAddedName}${amount} · ${count} total`;
}

/**
 * The single saved player whose name exactly matches `name`, or null when there
 * is no match or 2+ legacy-duplicate matches (ambiguous — the caller must not
 * auto-bind). Backs the "Using saved …" surface in the Add Players modal.
 */
export function singleExactSavedMatch(saved: SavedPlayer[], name: string): SavedPlayer | null {
  const matches = matchSavedByExactName(saved, name);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * True when the just-added player is already shown as an in-game "Added ✓" row
 * among the visible saved rows, making the confirmation banner redundant. Used
 * to smart-suppress the banner: show it only when the add is NOT otherwise
 * visible (e.g. a typed-new, non-saved name, or one past the visible limit).
 */
export function isLastAddVisibleInList(
  lastAddedName: string | null,
  visibleSaved: SavedPlayer[],
  players: Player[],
): boolean {
  const target = norm(lastAddedName ?? '');
  if (!target) return false;
  return visibleSaved.some(p => norm(p.name) === target && isNameTakenInGame(players, p.name));
}

/**
 * True when the post-add confirmation banner should render. The banner is
 * normally suppressed once the just-added player's row is already visible in
 * the list (isLastAddVisibleInList) — the in-list "Added ✓" row already
 * conveys the add. But that row carries no amount, so when the add carried a
 * default buy-in (lastAddedAmount !== null), the banner is the only place the
 * amount is shown — always show it in that case. Also requires a label to
 * exist at all (mirrors formatAddedConfirmation's own null cases).
 */
export function shouldShowAddedConfirmation(
  addedConfirmLabel: string | null,
  lastAddedAmount: number | null,
  lastAddedName: string | null,
  visibleSaved: SavedPlayer[],
  players: Player[],
): boolean {
  if (!addedConfirmLabel) return false;
  return lastAddedAmount !== null || !isLastAddVisibleInList(lastAddedName, visibleSaved, players);
}

/**
 * Saved players ordered by name, case-insensitive. Returns a NEW array; the input is not
 * mutated. This is the display order for the Add Players modal — deliberately not the
 * `updatedAt` desc order that savedPlayersService returns, because that key is bumped on
 * every add and would reorder the list under the user mid-session.
 */
export function sortSavedByName(saved: SavedPlayer[]): SavedPlayer[] {
  return [...saved].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
