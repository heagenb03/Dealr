import { Game, PaymentCarrier, PaymentHandles, PaymentMethod, Player, PreferredPayment } from '@/types/game';
import { PAYMENT_METHODS } from '@/constants/PaymentMethods';

const ORDER: PaymentMethod[] = PAYMENT_METHODS.map(m => m.key);

/**
 * The method whose entry drives the Pay button, the share message and the published
 * snapshot. Prefers the explicit `defaultMethod`, but only when that key is actually
 * present in the map; otherwise falls back to the first present key in PAYMENT_METHODS
 * declaration order, so a carrier that lost its default is never left with nothing.
 */
export function resolveDefaultMethod(c: PaymentCarrier | null | undefined): PaymentMethod | undefined {
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
export function resolvePayment(c: PaymentCarrier | null | undefined): PreferredPayment | undefined {
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
 * Normalize a carrier to the spec §1 invariant: every method PRESENT in the map is kept
 * (handle or not) and the default is always in the map. Returns a carrier with NO keys when
 * the map is empty, so callers can spread it conditionally.
 *
 * Presence is the signal, not the handle (bug-416). This rule used to prune any non-default
 * method whose handle was empty, which was right for the show-all-seven-rows editor: a key
 * was present there whether or not the user wanted the method, so an empty handle was the
 * only evidence they did not. b14d1b3 made the editor add-then-fill and left the save path
 * alone, at which point the premise was false — a key now exists precisely because the user
 * tapped Add, and removing a method deletes the key rather than blanking it. Pruning after
 * that deletes methods the user deliberately added: Cash always (it can never carry a
 * handle) once any typed row holds the default, and any row added but not yet typed into.
 */
export function applyPaymentInvariant(c: PaymentCarrier): PaymentCarrier {
  const source = c.methods ?? {};
  const present = ORDER.filter(k => k in source);
  const filled = ORDER.filter(k => (source[k] ?? '') !== '');
  // An EXPLICIT default is honoured even when it has no handle and no map entry — that is
  // how Cash, and a label-only Venmo, get saved. An ABSENT default prefers the first FILLED
  // method: a typed handle is a stronger claim than mere presence, and it is what the share
  // message and the published /g/ snapshot render (both read only resolvePayment). Only when
  // nothing is filled does the first present method take it, so a lone blank row still saves.
  const defaultMethod = c.defaultMethod ?? filled[0] ?? present[0];
  if (!defaultMethod) return {};

  const methods: PaymentHandles = {};
  for (const key of ORDER) {
    const raw = source[key];
    if (key === defaultMethod) methods[key] = raw ?? '';
    else if (key in source) methods[key] = raw as string;
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

/**
 * Attach the derived legacy `preferredPayment` to every player on the way OUT to storage.
 *
 * Dual-write rule (spec §2): the legacy field is DERIVED at the serialize boundary, never
 * stored in memory. Shipped 2.0.2 reads game docs through a whitelist that drops methods/
 * defaultMethod, so without this a 2.0.2 device sees no payment data at all.
 */
export function withLegacyPayment(game: Game): Game {
  return {
    ...game,
    players: game.players.map((p: Player) => {
      const legacy = resolvePayment(p);
      return legacy ? { ...p, preferredPayment: legacy } : p;
    }),
  };
}

/**
 * List-level counterpart to withLegacyPayment for a flat array of payment carriers (e.g. the
 * saved-players pool, which has no nested `players` array to map over). Same dual-write rule
 * (spec §2): attach the derived legacy `preferredPayment` to each entry at the serialize
 * boundary — never carry it in memory, and never assign it inside a function that builds an
 * entry, or any write path that doesn't go through that function loses the legacy field.
 */
export function withLegacyPaymentList<T extends PaymentCarrier>(
  list: T[],
): (T & { preferredPayment?: PreferredPayment })[] {
  return list.map(p => {
    const legacy = resolvePayment(p);
    return legacy ? { ...p, preferredPayment: legacy } : p;
  });
}

/**
 * Fill in methods/defaultMethod on the way IN, for a record written before this feature
 * (or by a 2.0.2 device, which strips the new fields on write). Stored methods win: a
 * legacy field written by an old client is by definition not newer information.
 *
 * The legacy field is DROPPED from the returned object. That is what keeps the "nothing in
 * memory carries preferredPayment" constraint true at the read boundary, rather than relying
 * on every downstream caller to ignore it.
 */
export function withSynthesizedMethods<T extends PaymentCarrier & { preferredPayment?: PreferredPayment }>(
  p: T,
): Omit<T, 'preferredPayment'> {
  const { preferredPayment, ...rest } = p;
  if (rest.methods) return rest;
  const lifted = fromLegacyPayment(preferredPayment);
  return lifted.methods ? { ...rest, ...lifted } : rest;
}

/**
 * Whether a mid-game payment edit should be pushed to the bound saved player silently,
 * behind a confirm, or not at all (spec §4).
 *
 * "Silent" is reserved for cases where nothing the user previously entered is lost:
 * the saved entry was blank, or the edit only ADDS methods without touching an existing
 * handle or moving the default.
 */
export function paymentWriteBackAction(
  saved: PaymentCarrier | undefined,
  next: PaymentCarrier,
): 'skip' | 'silent' | 'confirm' {
  if (samePaymentSet(saved, next)) return 'skip';

  const savedMethods = saved?.methods ?? {};
  const savedKeys = Object.keys(savedMethods) as PaymentMethod[];
  if (savedKeys.length === 0) return 'silent';

  const nextMethods = next.methods ?? {};
  const removed = savedKeys.some(k => !(k in nextMethods));
  // Only a saved handle that was NON-EMPTY can be overwritten. Filling in a blank saved row
  // destroys nothing the user entered, so it takes the silent path (bug-420) — the confirm it
  // used to raise contradicted this function's own rule. The reverse direction, clearing a real
  // handle down to '', still counts: it is a change from non-empty and rests entirely on this
  // check now that a blanked row is kept rather than dropped (so `removed` no longer sees it).
  const changed = savedKeys.some(
    k => k in nextMethods && (savedMethods[k] ?? '') !== '' && savedMethods[k] !== nextMethods[k],
  );
  const defaultMoved = resolveDefaultMethod(saved) !== resolveDefaultMethod(next);

  return removed || changed || defaultMoved ? 'confirm' : 'silent';
}

/**
 * The payload to actually persist for a 'silent' or 'confirm' write-back.
 *
 * `updateSavedPlayer`'s whole-map-replace patch treats an ABSENT `methods` key as "not
 * patching payment at all" — that is its own recency-bump convention
 * (`updateSavedPlayer(uid, sid, {})`), documented in savedPlayersService.ts. But when the
 * editor's carrier was emptied out (every handle cleared, so `applyPaymentInvariant`
 * returned `{}` with no `methods` key), a write-back means "clear the saved entry too",
 * which needs an EXPLICIT empty map to actually replace what was there — passing the bare
 * `{}` straight through would silently keep the saved player's old payment.
 */
export function paymentWriteBackPatch(payment: PaymentCarrier): PaymentCarrier {
  return payment.methods ? payment : { methods: {} };
}
