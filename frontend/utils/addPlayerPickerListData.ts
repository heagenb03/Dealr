/**
 * Item union for the Add Players modal's saved-player picker.
 *
 * No react-native import, and no import of savedPlayersService either — that would
 * pull AsyncStorage into a pure-data test. The caller pre-projects each SavedPlayer
 * down to the three primitives below, which is also what keeps SavedPickerRow's
 * comparator free of object props (see utils/savedPickerRow.ts).
 */

/** A saved player already reduced to what the row renders. */
export interface PickerRowSource {
  id: string;
  name: string;
  /** Preferred-payment badge, or null when the player has none. */
  badge: string | null;
}

export type AddPlayerPickerItem = {
  type: 'savedRow';
  /** FlatList key — the saved-player id. */
  key: string;
  id: string;
  name: string;
  badge: string | null;
  /** True when a player of this name is already in the game — renders "Added ✓". */
  inGame: boolean;
  /** True when the row must not respond to taps (already in game, or player cap hit). */
  disabled: boolean;
  /** True for the final row — drops the bottom border. */
  isLast: boolean;
};

/**
 * Projects already-filtered, already-sorted saved rows into picker items.
 *
 * `isInGame` is matched by NAME, not id, because the add flow can create an
 * in-game player whose name matches a saved entry it was never linked to.
 */
export function buildAddPlayerPickerListData(
  rows: readonly PickerRowSource[],
  isInGame: (name: string) => boolean,
  atPlayerCap: boolean,
): AddPlayerPickerItem[] {
  return rows.map((r, index) => {
    const inGame = isInGame(r.name);
    return {
      type: 'savedRow' as const,
      key: r.id,
      id: r.id,
      name: r.name,
      badge: r.badge,
      inGame,
      disabled: inGame || atPlayerCap,
      isLast: index === rows.length - 1,
    };
  });
}
