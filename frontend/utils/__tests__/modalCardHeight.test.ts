import { computeCardLift, KEYBOARD_LIFT_MARGIN } from '@/utils/keyboardLift';
import {
  keyboardSafeCardMaxHeight,
  KEYBOARD_SAFE_CARD_FRACTION,
  BROWSE_CARD_FRACTION,
  addPlayerCardMaxHeight,
} from '@/utils/modalCardHeight';

/**
 * Nominal portrait window heights paired with the default English keyboard
 * height INCLUDING the QuickType suggestion bar. These are the sizing inputs
 * the 0.5 fraction was derived against.
 */
const DEVICES = [
  { name: 'iPhone SE (3rd gen)', window: 667, keyboard: 260, expectedMax: 334 },
  { name: 'iPhone 14', window: 844, keyboard: 336, expectedMax: 422 },
  { name: 'iPhone 15 Pro Max', window: 932, keyboard: 346, expectedMax: 466 },
];

describe('keyboardSafeCardMaxHeight', () => {
  it('exposes the spec fraction', () => {
    expect(KEYBOARD_SAFE_CARD_FRACTION).toBe(0.5);
  });

  it.each(DEVICES)('caps the card on $name', ({ window, expectedMax }) => {
    expect(keyboardSafeCardMaxHeight(window)).toBe(expectedMax);
  });

  it('is monotonic in window height', () => {
    expect(keyboardSafeCardMaxHeight(600)).toBeLessThan(keyboardSafeCardMaxHeight(900));
  });

  it('returns 0 before layout has measured the window', () => {
    expect(keyboardSafeCardMaxHeight(0)).toBe(0);
  });

  it('honors a custom fraction override', () => {
    expect(keyboardSafeCardMaxHeight(800, 0.25)).toBe(200);
  });
});

describe('a capped card clears the keyboard (cross-property with computeCardLift)', () => {
  it.each(DEVICES)(
    'leaves exactly KEYBOARD_LIFT_MARGIN above the keyboard on $name',
    ({ window, keyboard }) => {
      const h = keyboardSafeCardMaxHeight(window);
      const lift = computeCardLift(keyboard, window, h);
      // A centered card's bottom edge sits at (window + h) / 2, then rises by lift.
      const cardBottom = (window + h) / 2 - lift;
      expect(cardBottom).toBe(window - keyboard - KEYBOARD_LIFT_MARGIN);
    },
  );

  it('still clears an oversized keyboard on the tightest device', () => {
    // iPhone SE with a 300pt keyboard — past the 297pt full-margin threshold, so
    // computeCardLift clamps at maxLift and the 12pt cushion erodes. The button
    // must still be visible: this is the case a taller third-party keyboard hits.
    const window = 667;
    const keyboard = 300;
    const h = keyboardSafeCardMaxHeight(window); // 334
    const lift = computeCardLift(keyboard, window, h); // clamped to 142.5
    const cardBottom = (window + h) / 2 - lift; // 358
    expect(cardBottom).toBeLessThanOrEqual(window - keyboard); // 367
  });
});

describe('addPlayerCardMaxHeight', () => {
  it('exposes the browse fraction', () => {
    expect(BROWSE_CARD_FRACTION).toBe(0.8);
  });

  it.each(DEVICES)(
    'matches the keyboard-safe cap when the keyboard is up on $name',
    ({ window, expectedMax }) => {
      expect(addPlayerCardMaxHeight(window, true)).toBe(expectedMax);
    },
  );

  it.each(DEVICES)('grows to 80% with the keyboard down on $name', ({ window }) => {
    expect(addPlayerCardMaxHeight(window, false)).toBe(Math.round(window * 0.8));
  });

  it.each(DEVICES)('is always taller with the keyboard down on $name', ({ window }) => {
    expect(addPlayerCardMaxHeight(window, false)).toBeGreaterThan(
      addPlayerCardMaxHeight(window, true),
    );
  });

  it('returns 0 before layout has measured the window', () => {
    expect(addPlayerCardMaxHeight(0, false)).toBe(0);
    expect(addPlayerCardMaxHeight(0, true)).toBe(0);
  });

  it('honors custom fraction overrides independently', () => {
    expect(addPlayerCardMaxHeight(800, true, 0.25)).toBe(200);
    expect(addPlayerCardMaxHeight(800, false, 0.25, 0.75)).toBe(600);
  });

  // The notch invariant. A centered card leaves (window - card) / 2 above it, and the
  // top safe-area inset must fit inside that gap or the card's first row renders under
  // the notch. The largest current iPhone top inset is ~59pt on an 852pt window: 6.9%.
  // This is the property that rules out raising BROWSE_CARD_FRACTION to 0.85.
  it.each(DEVICES)('leaves a top gap clearing the notch inset on $name', ({ window }) => {
    const gap = (window - addPlayerCardMaxHeight(window, false)) / 2;
    expect(gap).toBeGreaterThanOrEqual(0.069 * window);
  });
});
