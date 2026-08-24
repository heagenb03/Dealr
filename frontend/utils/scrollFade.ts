/**
 * The predicate behind a bottom scroll-fade: is this scroll view showing its last pixel?
 *
 * Why this exists as a testable function rather than an inline expression: the version in
 * active.tsx (the Add Players picker, `pickerFadeStyle`) is three terms and an epsilon, and
 * two of its cases are ones no rendering test in this repo can observe — the fade's opacity
 * is produced by `useAnimatedStyle`, which is mocked to `{}` under jest-expo/node, so a
 * regression in the arithmetic is invisible to every component test. The cases that matter
 * most are also the two that a scroll handler alone can never report: content shorter than
 * the viewport (it never scrolls, so the handler never fires) and the all-zeros state before
 * the first layout pass. Both must read as at-end or the fade sits lit over a list with
 * nothing below it.
 *
 * `'worklet'` so it can be called from inside a Reanimated `useAnimatedStyle`, which runs on
 * the UI thread — an imported plain function called from a worklet throws there at runtime.
 * Established pattern in this repo, not a new one: `keyboardLift.ts`'s `computeCardLift` is
 * the same shape and is called from `AppModal.tsx`'s `useAnimatedStyle`, which is the iOS
 * keyboard lift under every modal in the app.
 *
 * The build wiring is worth writing down because it is two indirections deep on this version:
 * babel.config.js loads only `babel-preset-expo`, which auto-adds `react-native-reanimated/
 * plugin` when the package is installed — and on reanimated 4.2.1 that path is a two-line shim
 * re-exporting `react-native-worklets/plugin` (react-native-worklets 0.7.2, a direct
 * dependency). So the directive IS processed, in Jest as well; workletized functions stay
 * callable from the JS thread, which is how the tests below reach it.
 *
 * active.tsx still carries its own copy of this expression inline. It is deliberately not
 * changed here: that picker's scroll behaviour had its own device QA, and this rework was
 * scoped to the payment editor.
 */

/**
 * Tolerance in points. Sub-pixel layout rounding leaves `scrollY + viewportH` a hair short of
 * `contentH` at a real end-of-list stop; without this the fade never clears at the bottom,
 * which tells the user there is more content when there is not.
 */
export const SCROLL_END_EPSILON = 4;

export function isScrolledToEnd(
  scrollY: number,
  viewportH: number,
  contentH: number,
  epsilon: number = SCROLL_END_EPSILON,
): boolean {
  'worklet';
  return scrollY + viewportH >= contentH - epsilon;
}
