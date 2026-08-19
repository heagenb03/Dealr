import {
  PAYMENT_GRID_COLUMNS,
  buildPaymentGridRows,
  type PaymentGridSlot,
} from '@/utils/paymentGridRows';

const pay = (from: string, amount = 10) => ({ from, amount });

// Shorthand builders for the expected literals below. These describe the SHAPE we
// want; they deliberately contain no row/column arithmetic, so they cannot inherit
// an off-by-one from the implementation they are checking.
const cell = (from: string, amount = 10): PaymentGridSlot => ({ kind: 'cell', payment: { from, amount } });
const spacer = (): PaymentGridSlot => ({ kind: 'spacer' });
const rule = (): PaymentGridSlot => ({ kind: 'divider', visible: true });
const gap = (): PaymentGridSlot => ({ kind: 'divider', visible: false });

describe('buildPaymentGridRows', () => {
  it('defaults to a 3-column grid', () => {
    expect(PAYMENT_GRID_COLUMNS).toBe(3);
  });

  it('returns no rows for no payments', () => {
    expect(buildPaymentGridRows([])).toEqual([]);
  });

  // The N=1..7 sweep below asserts the FULL slot array of every row, not a divider
  // count. A count cannot discriminate here: for N=3 the old `index % 3 !== 0` rule
  // emitted 2 dividers and a correct 3-column grid also wants 2, so a count
  // assertion passes on both. Only the positions tell them apart.

  it('pads a single payment out to a full-width row', () => {
    expect(buildPaymentGridRows([pay('Alice')])).toEqual([
      [cell('Alice'), gap(), spacer(), gap(), spacer()],
    ]);
  });

  it('shows one rule between two payments and pads the third column', () => {
    expect(buildPaymentGridRows([pay('Alice'), pay('Bob')])).toEqual([
      [cell('Alice'), rule(), cell('Bob'), gap(), spacer()],
    ]);
  });

  it('keeps three payments on ONE row with two rules and no trailing rule', () => {
    // The old code wrapped here: Carol was pushed to a second line and the second
    // divider was left dangling at the right edge of row 0.
    expect(buildPaymentGridRows([pay('Alice'), pay('Bob'), pay('Carol')])).toEqual([
      [cell('Alice'), rule(), cell('Bob'), rule(), cell('Carol')],
    ]);
  });

  it('starts a new row at the fourth payment and still rules its columns', () => {
    // The old code suppressed the divider here entirely, because 3 % 3 === 0 read
    // the fourth payment as a row start when it was not one.
    expect(buildPaymentGridRows([pay('Alice'), pay('Bob'), pay('Carol'), pay('Dave')])).toEqual([
      [cell('Alice'), rule(), cell('Bob'), rule(), cell('Carol')],
      [cell('Dave'), gap(), spacer(), gap(), spacer()],
    ]);
  });

  it('rules the two cells of a partial second row', () => {
    expect(
      buildPaymentGridRows([pay('Alice'), pay('Bob'), pay('Carol'), pay('Dave'), pay('Erin')]),
    ).toEqual([
      [cell('Alice'), rule(), cell('Bob'), rule(), cell('Carol')],
      [cell('Dave'), rule(), cell('Erin'), gap(), spacer()],
    ]);
  });

  it('fills two complete rows without padding', () => {
    expect(
      buildPaymentGridRows([
        pay('Alice'), pay('Bob'), pay('Carol'), pay('Dave'), pay('Erin'), pay('Frank'),
      ]),
    ).toEqual([
      [cell('Alice'), rule(), cell('Bob'), rule(), cell('Carol')],
      [cell('Dave'), rule(), cell('Erin'), rule(), cell('Frank')],
    ]);
  });

  it('pads a lone seventh payment on a third row', () => {
    expect(
      buildPaymentGridRows([
        pay('Alice'), pay('Bob'), pay('Carol'), pay('Dave'), pay('Erin'), pay('Frank'), pay('Gus'),
      ]),
    ).toEqual([
      [cell('Alice'), rule(), cell('Bob'), rule(), cell('Carol')],
      [cell('Dave'), rule(), cell('Erin'), rule(), cell('Frank')],
      [cell('Gus'), gap(), spacer(), gap(), spacer()],
    ]);
  });

  it('gives every row identical structure so columns line up across rows', () => {
    // This is the invariant the old wrapping layout broke: rows only stay aligned
    // if each one carries the same slot kinds in the same order.
    for (let n = 1; n <= 12; n++) {
      const rows = buildPaymentGridRows(Array.from({ length: n }, (_, i) => pay(`P${i}`)));
      for (const row of rows) {
        expect(row.map((slot) => (slot.kind === 'divider' ? 'divider' : 'box'))).toEqual([
          'box', 'divider', 'box', 'divider', 'box',
        ]);
      }
    }
  });

  it('carries the payments through in order, unmodified', () => {
    const payments = [pay('Alice', 124.5), pay('Bob', 88), pay('Carol', 12.25), pay('Dave', 3)];
    const seen = buildPaymentGridRows(payments)
      .flat()
      .filter((slot): slot is Extract<PaymentGridSlot, { kind: 'cell' }> => slot.kind === 'cell')
      .map((slot) => slot.payment);
    expect(seen).toEqual(payments);
  });

  it('honours a custom column count', () => {
    expect(buildPaymentGridRows([pay('Alice'), pay('Bob'), pay('Carol')], 2)).toEqual([
      [cell('Alice'), rule(), cell('Bob')],
      [cell('Carol'), gap(), spacer()],
    ]);
  });

  it('treats a column count below one as a single column', () => {
    expect(buildPaymentGridRows([pay('Alice'), pay('Bob')], 0)).toEqual([
      [cell('Alice')],
      [cell('Bob')],
    ]);
  });
});
