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
