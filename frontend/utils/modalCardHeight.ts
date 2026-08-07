/**
 * Fraction of the window height a keyboard-facing modal card may occupy.
 *
 * Derived from computeCardLift (see ./keyboardLift.ts). A vertically-centered
 * card can only rise by `(window - card) / 2 - CARD_TOP_INSET`, so a TALL card
 * has almost no room to lift and cannot clear the keyboard at all. Solving
 * `lift >= needed` for the card height gives:
 *
 *   cardHeight <= window - (keyboard + KEYBOARD_LIFT_MARGIN + CARD_TOP_INSET)
 *
 * At 0.5 the cap tolerates a keyboard up to `window/2 - 24` before the card's
 * bottom edge is covered — 309pt on an iPhone SE against a nominal 260pt
 * keyboard, ~49pt of slack for taller third-party or non-English keyboards.
 * 0.55 was rejected: it leaves only 16pt.
 */
export const KEYBOARD_SAFE_CARD_FRACTION = 0.5;

/**
 * Largest card height that still lets computeCardLift raise the card's bottom
 * edge clear of the keyboard. Rounded to whole points so layout and tests agree.
 *
 * Pure: no imports, no platform access. `fraction` is injectable for tests.
 */
export function keyboardSafeCardMaxHeight(
  windowHeight: number,
  fraction: number = KEYBOARD_SAFE_CARD_FRACTION,
): number {
  return Math.round(windowHeight * fraction);
}

/**
 * Fraction of the window height the Add Players card may occupy when NO keyboard is up.
 *
 * Bounded by the notch, not by taste. A vertically-centered card leaves
 * `(window - card) / 2` above it, so at 0.80 the top gap is 10% of the window. The top
 * safe-area inset must fit inside that gap or the card's first row renders under the
 * notch. The largest current iPhone top inset is ~59pt on an 852pt window — 6.9% — so
 * 10% clears every device with margin.
 *
 * 0.85 was rejected: it leaves a 7.5% gap, 64pt against that 59pt inset — 5pt of slack,
 * thinner than the ~49pt KEYBOARD_SAFE_CARD_FRACTION was deliberately chosen for.
 */
export const BROWSE_CARD_FRACTION = 0.8;

/**
 * Largest card height for the Add Players modal in either of its two discrete states.
 *
 * With a keyboard up the card must stay small enough for computeCardLift to raise its
 * PINNED footer clear of the keyboard, which is exactly what keyboardSafeCardMaxHeight
 * encodes. With no keyboard that constraint does not exist, so the card grows to
 * BROWSE_CARD_FRACTION — taking the saved-player list from 2 visible rows to 7 on a
 * 667pt device.
 *
 * Pure: no imports, no platform access. Both fractions injectable for tests.
 */
export function addPlayerCardMaxHeight(
  windowHeight: number,
  keyboardVisible: boolean,
  keyboardFraction: number = KEYBOARD_SAFE_CARD_FRACTION,
  browseFraction: number = BROWSE_CARD_FRACTION,
): number {
  return keyboardVisible
    ? keyboardSafeCardMaxHeight(windowHeight, keyboardFraction)
    : Math.round(windowHeight * browseFraction);
}
