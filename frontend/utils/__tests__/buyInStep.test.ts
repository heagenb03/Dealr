/**
 * The +/- stepper arithmetic behind the Buy-in modal's step buttons.
 *
 * Why the step values below are deliberately NOT all integers: the modal field
 * holds a player's cumulative buy-in total as a string, and `isValidNumericInput`
 * (/^\d+\.?\d*$/) happily accepts "100.30000000000000004". A naive `base + step`
 * with a $12.50 default therefore persists a drifted amount, and an integer-only
 * suite passes that broken implementation on every case. Every clamp/round claim
 * here is asserted against a fractional step for that reason.
 */
import { stepBuyInTotal } from '@/utils/buyInStep';

describe('stepBuyInTotal', () => {
  describe('empty field', () => {
    it('yields exactly the step on +', () => {
      expect(stepBuyInTotal('', 50, 1)).toBe('50');
      expect(stepBuyInTotal('', 12.5, 1)).toBe('12.5');
    });

    // Not "0": active.tsx opens the modal empty precisely because a 0 total is a
    // placeholder rather than a real value, and handleAddTransaction treats an
    // empty field as a silent no-op. Writing "0" here would turn a stray tap into
    // an explicit zero the user never asked for.
    it('stays empty on -', () => {
      expect(stepBuyInTotal('', 50, -1)).toBe('');
      expect(stepBuyInTotal('   ', 50, -1)).toBe('');
    });
  });

  describe('stepping up', () => {
    it('adds the step to the current total', () => {
      expect(stepBuyInTotal('100', 50, 1)).toBe('150');
      expect(stepBuyInTotal('0', 50, 1)).toBe('50');
    });

    it('does not accumulate float error across repeated steps', () => {
      let value = '';
      for (let i = 0; i < 8; i++) value = stepBuyInTotal(value, 12.5, 1);
      expect(value).toBe('100');

      let quarters = '';
      for (let i = 0; i < 7; i++) quarters = stepBuyInTotal(quarters, 0.25, 1);
      expect(quarters).toBe('1.75');
    });

    it('keeps every result acceptable to isValidNumericInput', () => {
      let value = '';
      for (let i = 0; i < 10; i++) {
        value = stepBuyInTotal(value, 12.5, 1);
        expect(value).toMatch(/^\d+\.?\d*$/);
      }
    });
  });

  describe('stepping down', () => {
    it('subtracts the step from the current total', () => {
      expect(stepBuyInTotal('150', 50, -1)).toBe('100');
      expect(stepBuyInTotal('100', 12.5, -1)).toBe('87.5');
    });

    // Reachable in one tap, and legitimate: confirming a 0 total routes to
    // setPlayerTransactionTotal, which deletes the player's buy-in row rather
    // than writing a zero-amount transaction.
    it('lands on "0" when the total is exactly one step', () => {
      expect(stepBuyInTotal('50', 50, -1)).toBe('0');
      expect(stepBuyInTotal('12.5', 12.5, -1)).toBe('0');
    });

    it('clamps at 0 rather than going negative', () => {
      expect(stepBuyInTotal('20', 50, -1)).toBe('0');
      expect(stepBuyInTotal('0', 50, -1)).toBe('0');
      expect(stepBuyInTotal('5', 12.5, -1)).toBe('0');
    });
  });

  describe('input the field can actually hold', () => {
    it('treats text with no leading number as 0', () => {
      expect(stepBuyInTotal('abc', 50, 1)).toBe('50');
      expect(stepBuyInTotal('abc', 50, -1)).toBe('0');
    });

    // parseFloat reads the leading prefix, so the digits the user already typed
    // survive the tap rather than collapsing to 0.
    it('keeps the leading number out of half-typed text', () => {
      expect(stepBuyInTotal('50..5', 50, 1)).toBe('100');
      expect(stepBuyInTotal('50abc', 50, 1)).toBe('100');
    });

    it('tolerates surrounding whitespace', () => {
      expect(stepBuyInTotal('  100  ', 50, 1)).toBe('150');
    });

    // decimal-pad lets a user leave the field mid-number ("100.").
    it('handles a trailing decimal point', () => {
      expect(stepBuyInTotal('100.', 50, 1)).toBe('150');
    });

    it('drops a trailing zero the user typed', () => {
      expect(stepBuyInTotal('100.50', 50, 1)).toBe('150.5');
    });
  });

  describe('degenerate steps', () => {
    // The caller gates on gameDefaultBuyIn > 0, so these are defensive only.
    it('is a no-op for a zero or non-finite step', () => {
      expect(stepBuyInTotal('100', 0, 1)).toBe('100');
      expect(stepBuyInTotal('100', NaN, 1)).toBe('100');
      expect(stepBuyInTotal('', 0, 1)).toBe('');
    });
  });
});
