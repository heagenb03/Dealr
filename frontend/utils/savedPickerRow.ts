/**
 * Props for the Add Players modal's saved-player row, plus the React.memo comparator that
 * guards it.
 *
 * Deliberately free of react-native imports: the jest-expo/node test preset has no RN
 * renderer, so anything a test touches must not pull in react-native. The component that
 * uses these lives in components/SavedPickerRow.tsx.
 */
export type SavedPickerRowProps = {
  /** Saved-player id. Passed back through onSelect so the row needs no object props. */
  id: string;
  /** Display name. */
  name: string;
  /** Preferred-payment badge, or null when the player has none. */
  badge: string | null;
  /** True when a player of this name is already in the game — renders "Added ✓". */
  inGame: boolean;
  /** True when the row must not respond to taps (already in game, or player cap hit). */
  disabled: boolean;
  /** True for the final row — drops the bottom border. */
  isLast: boolean;
  /** Tap handler. MUST be referentially stable or the memo never short-circuits. */
  onSelect: (id: string) => void;
};

/**
 * Shallow prop equality for SavedPickerRow. Every field is a primitive except onSelect,
 * which is compared by identity.
 *
 * There are deliberately NO object or array props. The add flow mutates
 * `activeGame.players` in place, so a comparator that received that array would compare
 * equal after a mutation and skip a re-render that was needed. The parent collapses it to
 * the `inGame` boolean instead.
 */
export function savedPickerRowPropsEqual(
  prev: SavedPickerRowProps,
  next: SavedPickerRowProps,
): boolean {
  return (
    prev.id === next.id &&
    prev.name === next.name &&
    prev.badge === next.badge &&
    prev.inGame === next.inGame &&
    prev.disabled === next.disabled &&
    prev.isLast === next.isLast &&
    prev.onSelect === next.onSelect
  );
}
