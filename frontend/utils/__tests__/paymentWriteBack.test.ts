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

  it('confirms when the edit clears a saved payment entirely', () => {
    // The clear path's own verdict, and the input paymentWriteBackPatch exists to rescue:
    // the editor emptied every row, so `next` is the bare `{}` applyPaymentInvariant returns.
    // Every saved key counts as removed, so this must be a CONFIRM — wiping the saved
    // player's payment is exactly the kind of loss the silent path is not allowed to cause.
    expect(paymentWriteBackAction(V, {})).toBe('confirm');
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

/**
 * bug-420 follow-on. `changed` compared the saved and next handles for equality, so filling in
 * a saved row that was BLANK counted as an overwrite and popped the "Update saved player?"
 * confirm mid-game — for an edit that loses nothing, contradicting this function's own rule
 * that silent is for cases where nothing the user previously entered is lost.
 *
 * Pre-existing rather than introduced by bug-420: a blank DEFAULT ({venmo:''}) was already
 * reachable and already misfired. Keeping every present method widened it from the default key
 * to any key, which is why it turned up in the flow Heagen was testing.
 */
describe('filling a saved BLANK handle is not an overwrite (bug-420)', () => {
  it('is silent when a blank non-default row is filled in', () => {
    expect(paymentWriteBackAction(
      { methods: { venmo: 'alice', zelle: '' }, defaultMethod: 'venmo' },
      { methods: { venmo: 'alice', zelle: 'z@x.com' }, defaultMethod: 'venmo' },
    )).toBe('silent');
  });

  it('is silent when the blank DEFAULT is filled in (reachable before bug-420 too)', () => {
    expect(paymentWriteBackAction(
      { methods: { venmo: '' }, defaultMethod: 'venmo' },
      { methods: { venmo: 'alice' }, defaultMethod: 'venmo' },
    )).toBe('silent');
  });

  it('still confirms when a REAL saved handle is overwritten', () => {
    expect(paymentWriteBackAction(
      { methods: { venmo: 'alice' }, defaultMethod: 'venmo' },
      { methods: { venmo: 'bob' }, defaultMethod: 'venmo' },
    )).toBe('confirm');
  });

  it('still confirms when a REAL saved handle is cleared to blank', () => {
    // The direction that DOES lose what the user entered — the row survives now, so this is
    // no longer covered by the `removed` check and rests entirely on `changed`.
    expect(paymentWriteBackAction(
      { methods: { venmo: 'alice' }, defaultMethod: 'venmo' },
      { methods: { venmo: '' }, defaultMethod: 'venmo' },
    )).toBe('confirm');
  });

  it('still confirms when filling a blank row also moves the default', () => {
    expect(paymentWriteBackAction(
      { methods: { venmo: 'alice', zelle: '' }, defaultMethod: 'venmo' },
      { methods: { venmo: 'alice', zelle: 'z@x.com' }, defaultMethod: 'zelle' },
    )).toBe('confirm');
  });
});
