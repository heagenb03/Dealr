import { savedPickerRowPropsEqual, SavedPickerRowProps } from '../savedPickerRow';

const noop = () => {};
const base = (over: Partial<SavedPickerRowProps> = {}): SavedPickerRowProps => ({
  id: 's_Mike',
  name: 'Mike',
  badge: null,
  inGame: false,
  disabled: false,
  isFirst: false,
  isLast: false,
  onSelect: noop,
  ...over,
});

describe('savedPickerRowPropsEqual', () => {
  it('is true for identical props', () => {
    expect(savedPickerRowPropsEqual(base(), base())).toBe(true);
  });

  // Regression guard. The add flow mutates activeGame.players in place, so a comparator
  // that took the players array and compared it shallowly would report "equal" here and
  // silently skip the re-render. inGame is a computed boolean precisely to avoid that.
  it('is false when inGame flips while the name is unchanged', () => {
    expect(savedPickerRowPropsEqual(base(), base({ inGame: true }))).toBe(false);
  });

  it('is false when the id changes', () => {
    expect(savedPickerRowPropsEqual(base(), base({ id: 's_Dave' }))).toBe(false);
  });
  it('is false when the name changes', () => {
    expect(savedPickerRowPropsEqual(base(), base({ name: 'Dave' }))).toBe(false);
  });
  it('is false when the badge changes', () => {
    expect(savedPickerRowPropsEqual(base(), base({ badge: 'Venmo · @mike' }))).toBe(false);
  });
  it('is false when disabled changes', () => {
    expect(savedPickerRowPropsEqual(base(), base({ disabled: true }))).toBe(false);
  });
  // Regression guard for the grouped-panel work: isFirst draws the panel's top edge and
  // top corner radii. The comparator is hand-written and silently ignores any prop it
  // does not name, so an omission here leaves a stale top edge on a row that is no
  // longer first — visible only after a search filters the list.
  it('is false when isFirst changes', () => {
    expect(savedPickerRowPropsEqual(base(), base({ isFirst: true }))).toBe(false);
  });
  it('is false when isLast changes', () => {
    expect(savedPickerRowPropsEqual(base(), base({ isLast: true }))).toBe(false);
  });
  it('is false when the onSelect identity changes', () => {
    expect(savedPickerRowPropsEqual(base(), base({ onSelect: () => {} }))).toBe(false);
  });
});
