import {
  resolveDefaultMethod,
  resolvePayment,
  fromLegacyPayment,
  applyPaymentInvariant,
  paymentSignature,
  samePaymentSet,
} from '@/utils/paymentMethods';

describe('resolveDefaultMethod', () => {
  it('returns the explicit default when it is present in the map', () => {
    expect(resolveDefaultMethod({ methods: { venmo: 'a', zelle: 'b' }, defaultMethod: 'zelle' })).toBe('zelle');
  });

  it('falls back to PAYMENT_METHODS order when the default is unset', () => {
    // cash < venmo < cashapp < paypal < zelle < applecash < other
    expect(resolveDefaultMethod({ methods: { zelle: 'b', venmo: 'a' } })).toBe('venmo');
  });

  it('falls back to PAYMENT_METHODS order when the default points at a missing key', () => {
    expect(resolveDefaultMethod({ methods: { zelle: 'b' }, defaultMethod: 'venmo' })).toBe('zelle');
  });

  it('returns undefined for an empty or absent carrier', () => {
    expect(resolveDefaultMethod({ methods: {} })).toBeUndefined();
    expect(resolveDefaultMethod({})).toBeUndefined();
    expect(resolveDefaultMethod(undefined)).toBeUndefined();
  });
});

describe('resolvePayment', () => {
  it('returns the default entry as a PreferredPayment', () => {
    expect(resolvePayment({ methods: { venmo: 'alice' }, defaultMethod: 'venmo' })).toEqual({
      method: 'venmo',
      handle: 'alice',
    });
  });

  it('omits handle entirely for a label-only default', () => {
    const out = resolvePayment({ methods: { venmo: '' }, defaultMethod: 'venmo' });
    expect(out).toEqual({ method: 'venmo' });
    expect('handle' in out!).toBe(false);
  });

  it('omits handle for cash', () => {
    expect(resolvePayment({ methods: { cash: '' }, defaultMethod: 'cash' })).toEqual({ method: 'cash' });
  });

  it('returns undefined when there is nothing saved', () => {
    expect(resolvePayment({})).toBeUndefined();
  });
});

describe('fromLegacyPayment', () => {
  it('lifts a handled entry into a one-key map', () => {
    expect(fromLegacyPayment({ method: 'venmo', handle: 'alice' })).toEqual({
      methods: { venmo: 'alice' },
      defaultMethod: 'venmo',
    });
  });

  it('lifts a label-only entry, preserving it as an empty-string handle', () => {
    expect(fromLegacyPayment({ method: 'venmo' })).toEqual({
      methods: { venmo: '' },
      defaultMethod: 'venmo',
    });
  });

  it('returns an empty carrier for undefined', () => {
    expect(fromLegacyPayment(undefined)).toEqual({});
  });

  it('round-trips a label-only entry through resolvePayment unchanged', () => {
    const legacy = { method: 'venmo' as const };
    expect(resolvePayment(fromLegacyPayment(legacy))).toEqual(legacy);
  });

  it('round-trips a handled entry through resolvePayment unchanged', () => {
    const legacy = { method: 'cashapp' as const, handle: 'alice-c' };
    expect(resolvePayment(fromLegacyPayment(legacy))).toEqual(legacy);
  });
});

describe('applyPaymentInvariant', () => {
  it('keeps the default even with an empty handle', () => {
    expect(applyPaymentInvariant({ methods: { venmo: '' }, defaultMethod: 'venmo' })).toEqual({
      methods: { venmo: '' },
      defaultMethod: 'venmo',
    });
  });

  it('keeps a non-default method whose handle is empty', () => {
    // Reversed at bug-416: this asserted `{ venmo: 'a' }` and so pinned the drop the editor
    // was reported for. A key is present because the user added the method; removing one
    // deletes the key (removeMethod), it does not blank it.
    expect(applyPaymentInvariant({ methods: { venmo: 'a', zelle: '' }, defaultMethod: 'venmo' })).toEqual({
      methods: { venmo: 'a', zelle: '' },
      defaultMethod: 'venmo',
    });
  });

  it('adds a defaultMethod that is missing from the map', () => {
    expect(applyPaymentInvariant({ methods: { venmo: 'a' }, defaultMethod: 'cash' })).toEqual({
      methods: { venmo: 'a', cash: '' },
      defaultMethod: 'cash',
    });
  });

  it('fills an unset default from PAYMENT_METHODS order', () => {
    expect(applyPaymentInvariant({ methods: { zelle: 'z', venmo: 'v' } })).toEqual({
      methods: { zelle: 'z', venmo: 'v' },
      defaultMethod: 'venmo',
    });
  });

  it('returns a carrier with no keys only when there are no methods at all', () => {
    // Narrowed at bug-416: `{ venmo: '' }` used to land here and lose the row outright. An
    // empty map and an absent one are still the two cases with nothing to keep.
    expect(applyPaymentInvariant({ methods: {} })).toEqual({});
    expect(applyPaymentInvariant({})).toEqual({});
  });
});

describe('paymentSignature / samePaymentSet', () => {
  it('is stable across key insertion order', () => {
    const a = { methods: { zelle: 'z', venmo: 'v' }, defaultMethod: 'venmo' as const };
    const b = { methods: { venmo: 'v', zelle: 'z' }, defaultMethod: 'venmo' as const };
    expect(paymentSignature(a)).toBe(paymentSignature(b));
    expect(samePaymentSet(a, b)).toBe(true);
  });

  it('differs when only the default moved', () => {
    const a = { methods: { venmo: 'v', zelle: 'z' }, defaultMethod: 'venmo' as const };
    const b = { methods: { venmo: 'v', zelle: 'z' }, defaultMethod: 'zelle' as const };
    expect(samePaymentSet(a, b)).toBe(false);
  });

  it('differs when a handle changed', () => {
    const a = { methods: { venmo: 'v' }, defaultMethod: 'venmo' as const };
    const b = { methods: { venmo: 'w' }, defaultMethod: 'venmo' as const };
    expect(samePaymentSet(a, b)).toBe(false);
  });

  it('differs when a non-default method was added', () => {
    const a = { methods: { venmo: 'v' }, defaultMethod: 'venmo' as const };
    const b = { methods: { venmo: 'v', zelle: 'z' }, defaultMethod: 'venmo' as const };
    expect(samePaymentSet(a, b)).toBe(false);
  });

  it('treats a label-only entry as distinct from no entry', () => {
    expect(samePaymentSet({ methods: { venmo: '' }, defaultMethod: 'venmo' }, {})).toBe(false);
  });

  it('treats two empty carriers as the same', () => {
    expect(samePaymentSet({}, undefined)).toBe(true);
  });
});

/**
 * bug-416. The prune rule below ("a non-default method survives only with a non-empty
 * handle") encoded a premise that stopped being true at b14d1b3: in the show-all-seven-rows
 * editor a key was present whether or not the user wanted the method, so an empty handle was
 * the only signal that they did not. Add-then-fill makes presence itself the signal — the key
 * exists because the user tapped Add, and removal deletes the key rather than blanking it.
 */
describe('applyPaymentInvariant — presence is the signal (bug-416)', () => {
  it('keeps a non-default method that has no handle', () => {
    expect(applyPaymentInvariant({ methods: { venmo: 'a', zelle: '' }, defaultMethod: 'venmo' })).toEqual({
      methods: { venmo: 'a', zelle: '' },
      defaultMethod: 'venmo',
    });
  });

  it('keeps handle-less cash when another method holds the default', () => {
    // Cash can NEVER carry a handle (takesHandle: false), so under the old rule it survived
    // only by holding the default — which it cannot do once a typed row claimed it.
    expect(applyPaymentInvariant({ methods: { cash: '', venmo: 'a' }, defaultMethod: 'venmo' })).toEqual({
      methods: { cash: '', venmo: 'a' },
      defaultMethod: 'venmo',
    });
  });

  it('keeps a lone blank method without letting it claim the default', () => {
    // Both halves are the point. The row surviving is bug-416. The default staying UNCLAIMED
    // is bug-421: a fabricated default is indistinguishable downstream from one the user
    // chose, and the editor reads it back as a choice.
    const out = applyPaymentInvariant({ methods: { venmo: '' } });
    expect(out.methods).toEqual({ venmo: '' });
    expect(out.defaultMethod).toBeUndefined();
  });

  it('still prefers a FILLED method over a blank one when no default is set', () => {
    // Presence is enough to survive, but a typed handle is still the stronger claim on the
    // default: cash sits ahead of venmo in PAYMENT_METHODS order, and must not take it.
    expect(applyPaymentInvariant({ methods: { cash: '', venmo: 'a' } })).toEqual({
      methods: { cash: '', venmo: 'a' },
      defaultMethod: 'venmo',
    });
  });

  it('still returns a carrier with no keys when there are no methods at all', () => {
    expect(applyPaymentInvariant({ methods: {} })).toEqual({});
    expect(applyPaymentInvariant({})).toEqual({});
  });
});

/**
 * bug-421, the follow-on to bug-416. Keeping every present method made a second premise
 * false: `?? present[0]` promoted a row the user had typed nothing into to defaultMethod,
 * and persisted it as an EXPLICIT choice. PaymentEditorContent seeds its own default state
 * from the saved carrier and only ever auto-assigns while that state is `undefined`, so a
 * fabricated default is permanent - the next handle the user types can never claim it, and
 * the card badge, the share message and the /g/ snapshot all name a method with no handle.
 *
 * Presence still keeps the row. It just no longer counts as choosing it.
 */
describe('applyPaymentInvariant - a blank row does not claim the default (bug-421)', () => {
  it('keeps a map of only blank rows and leaves the default unclaimed', () => {
    const out = applyPaymentInvariant({ methods: { venmo: '', zelle: '' } });
    expect(out.methods).toEqual({ venmo: '', zelle: '' });
    expect(out.defaultMethod).toBeUndefined();
  });

  it('OMITS the defaultMethod key rather than setting it to undefined', () => {
    // toStrictEqual, not toEqual: toEqual treats an undefined-valued key as absent, so it
    // cannot tell these apart. They persist identically today (stripUndefined drops it on the
    // Firestore path, JSON.stringify on the AsyncStorage one), which is exactly why the
    // distinction needs pinning here rather than being left to a future reader to rediscover.
    expect(applyPaymentInvariant({ methods: { venmo: '' } })).toStrictEqual({
      methods: { venmo: '' },
    });
  });

  it('honours an EXPLICIT handle-less default even when another row is filled', () => {
    // The case that rules out solving this by preferring filled handles inside
    // resolveDefaultMethod: the per-row dot is tappable from the second row, so a blank
    // Venmo IS a choice a user can make, and Cash can never carry a handle at all.
    expect(
      applyPaymentInvariant({ methods: { venmo: '', cashapp: 'alice' }, defaultMethod: 'venmo' }),
    ).toEqual({ methods: { venmo: '', cashapp: 'alice' }, defaultMethod: 'venmo' });
    expect(
      applyPaymentInvariant({ methods: { cash: '', venmo: 'alice' }, defaultMethod: 'cash' }),
    ).toEqual({ methods: { cash: '', venmo: 'alice' }, defaultMethod: 'cash' });
  });

  it('still gives the default to the first FILLED method when none was chosen', () => {
    const out = applyPaymentInvariant({ methods: { cash: '', venmo: 'alice' } });
    expect(out).toEqual({ methods: { cash: '', venmo: 'alice' }, defaultMethod: 'venmo' });
  });

  it('still returns a carrier with no keys when the map is empty', () => {
    // The `?? present[0]` removal must not resurrect the collapse bug-416 fixed: an EMPTY
    // map is the only thing left that produces a bare {}.
    expect(applyPaymentInvariant({ methods: {} })).toEqual({});
    expect(applyPaymentInvariant({})).toEqual({});
  });
});
