import { paymentWriteBackAction, paymentWriteBackPatch } from '@/utils/paymentMethods';

const V = { methods: { venmo: 'v' }, defaultMethod: 'venmo' as const };

describe('paymentWriteBackAction', () => {
  it('writes silently when the saved player has nothing', () => {
    expect(paymentWriteBackAction(undefined, V)).toBe('silent');
    expect(paymentWriteBackAction({}, V)).toBe('silent');
  });

  it('skips when nothing changed', () => {
    expect(paymentWriteBackAction(V, V)).toBe('skip');
  });

  it('writes silently when a new method is added and nothing else moved', () => {
    expect(
      paymentWriteBackAction(V, { methods: { venmo: 'v', zelle: 'z' }, defaultMethod: 'venmo' }),
    ).toBe('silent');
  });

  it('confirms when an existing handle changed', () => {
    expect(paymentWriteBackAction(V, { methods: { venmo: 'w' }, defaultMethod: 'venmo' })).toBe('confirm');
  });

  it('confirms when only the default moved', () => {
    const saved = { methods: { venmo: 'v', zelle: 'z' }, defaultMethod: 'venmo' as const };
    const next = { methods: { venmo: 'v', zelle: 'z' }, defaultMethod: 'zelle' as const };
    expect(paymentWriteBackAction(saved, next)).toBe('confirm');
  });

  it('confirms when a method was removed', () => {
    const saved = { methods: { venmo: 'v', zelle: 'z' }, defaultMethod: 'venmo' as const };
    expect(paymentWriteBackAction(saved, V)).toBe('confirm');
  });

  it('confirms when an added method also takes over as default', () => {
    expect(
      paymentWriteBackAction(V, { methods: { venmo: 'v', zelle: 'z' }, defaultMethod: 'zelle' }),
    ).toBe('confirm');
  });

  it('skips when the incoming carrier is empty and the saved one is too', () => {
    expect(paymentWriteBackAction({}, {})).toBe('skip');
  });

  it('does not confirm when the saved entry has no explicit default matching the fallback', () => {
    // A saved player coerced from storage can carry `methods` with no `defaultMethod`.
    // Both sides must resolve through the PAYMENT_METHODS-order fallback, or every mid-game
    // edit of a pre-existing player pops a spurious "Update saved player?" alert.
    const saved = { methods: { venmo: 'v' } };
    const next = { methods: { venmo: 'v' }, defaultMethod: 'venmo' as const };
    expect(paymentWriteBackAction(saved, next)).toBe('skip');
  });
});

describe('paymentWriteBackPatch', () => {
  // updateSavedPlayer's whole-map-replace treats an ABSENT `methods` key as "not patching
  // payment" (its own recency-bump convention: updateSavedPlayer(uid, sid, {})). A write-back
  // whose carrier was emptied out by the editor (every handle cleared) must still turn into an
  // explicit clear, not a silent no-op — see the note in active.tsx's handleSavePayment.

  it('passes a non-empty carrier through unchanged', () => {
    expect(paymentWriteBackPatch(V)).toEqual(V);
  });

  it('turns a fully-cleared carrier into an explicit empty methods map', () => {
    expect(paymentWriteBackPatch({})).toEqual({ methods: {} });
  });
});
