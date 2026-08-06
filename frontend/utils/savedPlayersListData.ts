/**
 * Item union for the Saved Players screen.
 *
 * Generic over the player shape rather than importing SavedPlayer from
 * services/savedPlayersService: that module pulls in AsyncStorage, and this file must
 * stay importable from a pure-data test under the jest-expo/node preset.
 */

export interface SavedPlayersListEmptyItem {
  type: 'empty';
  key: 'empty';
}

export interface SavedPlayersListRowItem<P> {
  type: 'savedPlayer';
  /** FlatList key — the saved-player id. */
  key: string;
  player: P;
}

export type SavedPlayersListItem<P> = SavedPlayersListRowItem<P> | SavedPlayersListEmptyItem;

/**
 * Sorts case-insensitively by name and projects into row items, or a single empty item
 * when there are none.
 *
 * The sort lives here rather than in the screen because the screen's version was a bare
 * `[...players].sort(...)` recomputed on every render, which would hand FlatList a fresh
 * `data` identity every time and defeat its diffing.
 */
export function buildSavedPlayersListData<P extends { id: string; name: string }>(
  players: readonly P[],
): SavedPlayersListItem<P>[] {
  const sorted = [...players].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  if (sorted.length === 0) return [{ type: 'empty', key: 'empty' }];
  return sorted.map(player => ({ type: 'savedPlayer' as const, key: player.id, player }));
}
