import { PaymentCarrier, PaymentHandles, PaymentMethod, PreferredPayment } from '@/types/game';
import { PAYMENT_METHODS } from '@/constants/PaymentMethods';

const ORDER: PaymentMethod[] = PAYMENT_METHODS.map(m => m.key);

/**
 * The method whose entry drives the Pay button, the share message and the published
 * snapshot. Prefers the explicit `defaultMethod`, but only when that key is actually
 * present in the map; otherwise falls back to the first present key in PAYMENT_METHODS
 * declaration order, so a carrier that lost its default is never left with nothing.
 */
export function resolveDefaultMethod(c: PaymentCarrier | undefined): PaymentMethod | undefined {
  const methods = c?.methods;
  if (!methods) return undefined;
  const explicit = c?.defaultMethod;
  if (explicit && explicit in methods) return explicit;
  return ORDER.find(k => k in methods);
}

/**
 * The default entry in the legacy `PreferredPayment` shape. This is BOTH what every read
 * site consumes and what the two serialize boundaries write as `preferredPayment`.
 *
 * `handle` is omitted rather than set to undefined when empty: Firestore rejects undefined
 * values, and sharedGameSnapshot.ts builds its map the same way for the same reason.
 */
export function resolvePayment(c: PaymentCarrier | undefined): PreferredPayment | undefined {
  const method = resolveDefaultMethod(c);
  if (!method) return undefined;
  const handle = c?.methods?.[method] ?? '';
  return handle ? { method, handle } : { method };
}

/** Inverse of resolvePayment: lift a legacy single entry into a one-key carrier. */
export function fromLegacyPayment(pref: PreferredPayment | undefined): PaymentCarrier {
  if (!pref) return {};
  return { methods: { [pref.method]: pref.handle ?? '' }, defaultMethod: pref.method };
}

/**
 * Normalize a carrier to the spec §1 invariant: the default is always in the map (handle
 * or not), non-default methods are present only with a non-empty handle. Returns a carrier
 * with NO keys when nothing survives, so callers can spread it conditionally.
 */
export function applyPaymentInvariant(c: PaymentCarrier): PaymentCarrier {
  const source = c.methods ?? {};
  const filled = ORDER.filter(k => (source[k] ?? '') !== '');
  // An EXPLICIT default is honoured even when it has no handle and no map entry — that is
  // how Cash, and a label-only Venmo, get saved. Only an ABSENT default falls back to the
  // first filled method in declaration order.
  const defaultMethod = c.defaultMethod ?? filled[0];
  if (!defaultMethod) return {};

  const methods: PaymentHandles = {};
  for (const key of ORDER) {
    const raw = source[key];
    if (key === defaultMethod) methods[key] = raw ?? '';
    else if ((raw ?? '') !== '') methods[key] = raw as string;
  }
  return { methods, defaultMethod };
}

/**
 * Stable scalar identity of a carrier — every entry in declaration order plus the resolved
 * default. Used by React.memo comparators, which must NOT compare the map by object identity:
 * active.tsx assigns into activeGame.players[idx] in place, so a mutated-then-cloned player
 * can hand a comparator the same object reference with different contents.
 */
export function paymentSignature(c: PaymentCarrier | undefined): string {
  const methods = c?.methods ?? {};
  const parts = ORDER.filter(k => k in methods).map(k => `${k}:${methods[k] ?? ''}`);
  return `${parts.join('|')}|*${resolveDefaultMethod(c) ?? ''}`;
}

/** True when two carriers hold the same handles AND the same default. */
export function samePaymentSet(a: PaymentCarrier | undefined, b: PaymentCarrier | undefined): boolean {
  return paymentSignature(a) === paymentSignature(b);
}

/** Methods with a non-empty handle, in PAYMENT_METHODS declaration order. */
export function filledMethods(c: PaymentCarrier | undefined): PaymentMethod[] {
  const methods = c?.methods ?? {};
  return ORDER.filter(k => (methods[k] ?? '') !== '');
}
