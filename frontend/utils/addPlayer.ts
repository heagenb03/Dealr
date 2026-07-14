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
 * An empty query returns the same list reference (preserves recent-first order).
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
export function formatAddedConfirmation(lastAddedName: string | null, count: number): string | null {
  if (count < 1 || !lastAddedName) return null;
  return `Added ${lastAddedName} · ${count} total`;
}
