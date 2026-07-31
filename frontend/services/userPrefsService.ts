import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Account-scoped storage for the user's *game default* preferences.
 *
 * These values were originally stored under device-global keys (`cc.currency`,
 * `cc.defaultBuyIn`, ...). That leaked one account's settings into another's
 * session on a shared device: account B, whose Firestore user doc carries no
 * value for the field, fell through to the AsyncStorage copy that account A had
 * written. For `defaultBuyIn` the leaked value is then stamped onto B's new
 * games and creates real buy-in transactions.
 *
 * Keys are now namespaced by uid. The local copy is still the offline-first
 * fallback for *that* account: signed in, offline, cold start, no user doc — B
 * resolves B's own last value and nobody else's.
 *
 * NOT covered here, deliberately: onboarding and review-prompt state
 * (`cc.intro_seen`, `cc.help_hint_seen`, `review_install_date`,
 * `review_games_completed`, `review_last_prompt_date`). Those describe the
 * device/install, not the account, and stay device-global.
 */

/** Base (unnamespaced) key per preference. Namespace with {@link prefKeyFor}. */
export const PREF_KEYS = {
  currency: 'cc.currency',
  defaultCashUnit: 'cc.defaultCashUnit',
  defaultSettlementMode: 'cc.defaultSettlementMode',
  defaultTolerance: 'cc.defaultTolerance',
  defaultBuyIn: 'cc.defaultBuyIn',
} as const;

/**
 * The pre-account-scoping device-global keys. These are PURGED, never migrated:
 * migrating would copy whoever-set-it-last into the first account that signs in
 * after the update, which is the leak this module exists to close. Anyone who
 * set a preference while signed in and online has it in their Firestore user
 * doc, which resolves ahead of storage anyway, so they see no change.
 */
export const LEGACY_PREF_KEYS: readonly string[] = Object.values(PREF_KEYS);

/** Per-account local key for a preference. */
export function prefKeyFor(base: string, uid: string): string {
  return `${base}:${uid}`;
}

/**
 * Read an account's stored preference. Returns null when signed out — there is
 * no anonymous bucket, and falling back to one would re-open the leak.
 */
export async function readPref(base: string, uid: string | undefined): Promise<string | null> {
  if (!uid) return null;
  try {
    return await AsyncStorage.getItem(prefKeyFor(base, uid));
  } catch {
    return null;
  }
}

/** Persist an account's preference. A no-op when signed out. Never throws. */
export async function writePref(
  base: string,
  uid: string | undefined,
  value: string
): Promise<void> {
  if (!uid) return;
  try {
    await AsyncStorage.setItem(prefKeyFor(base, uid), value);
  } catch {
    // Storage failure is not fatal — Firestore still carries the value.
  }
}

/**
 * Cache a value that resolved from the Firestore user doc into this account's
 * local key, but only when there is no local copy yet.
 *
 * This is what makes purging the legacy keys lossless. Without it, an existing
 * user whose first launch after the update happens OFFLINE loses the value
 * outright: `AuthContext` leaves `userDoc` null on the `unavailable` path, the
 * legacy key has just been purged, and the namespaced key was never written
 * (only the setters write it). It would not self-heal either — coming back
 * online populates `userDoc` for display but writes nothing locally, so every
 * later offline cold start would revert again. Seeding on resolve also gives a
 * second device a local cache without the user re-picking anything.
 *
 * `stored !== null` short-circuits, so a value the user changed on this device
 * is never clobbered by a staler doc copy.
 */
export async function seedPrefIfAbsent(
  base: string,
  uid: string | undefined,
  stored: string | null,
  resolved: string | number | undefined
): Promise<void> {
  if (!uid || stored !== null || resolved === undefined) return;
  await writePref(base, uid, String(resolved));
}

/** Drop the legacy device-global keys. Idempotent; never throws. */
export async function purgeLegacyPrefKeys(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([...LEGACY_PREF_KEYS]);
  } catch {
    // Nothing depends on the purge succeeding — the namespaced keys are the
    // only ones ever read.
  }
}

let purgeOnce: Promise<void> | null = null;

/** Run {@link purgeLegacyPrefKeys} at most once per app launch. */
export function ensureLegacyPrefsPurged(): Promise<void> {
  if (!purgeOnce) purgeOnce = purgeLegacyPrefKeys();
  return purgeOnce;
}

// ---------------------------------------------------------------------------
// Resolution: Firestore user doc wins, then this account's stored copy, then
// undefined (= "unset", which each caller maps to its own default).
//
// `0` is a LEGITIMATE value for defaultBuyIn — it is the OFF switch. Every
// check below is an explicit type/finite test for exactly that reason. Do not
// "simplify" any of these to `||` or a bare truthiness test.
// ---------------------------------------------------------------------------

function fromDoc(docValue: unknown): number | undefined {
  return typeof docValue === 'number' && Number.isFinite(docValue) ? docValue : undefined;
}

function fromStored(stored: string | null, parse: (s: string) => number): number | undefined {
  if (stored === null) return undefined;
  const n = parse(stored);
  return Number.isFinite(n) ? n : undefined;
}

/** Resolve a decimal preference (tolerance, buy-in). */
export function resolveFloatPref(docValue: unknown, stored: string | null): number | undefined {
  return fromDoc(docValue) ?? fromStored(stored, parseFloat);
}

/** Resolve an integer preference (cash rounding unit). */
export function resolveIntPref(docValue: unknown, stored: string | null): number | undefined {
  return fromDoc(docValue) ?? fromStored(stored, (s) => parseInt(s, 10));
}

/** Resolve a string-enum preference (settlement mode, currency code). */
export function resolveEnumPref<T extends string>(
  docValue: unknown,
  stored: string | null,
  allowed: readonly T[]
): T | undefined {
  if (typeof docValue === 'string' && (allowed as readonly string[]).includes(docValue)) {
    return docValue as T;
  }
  if (stored !== null && (allowed as readonly string[]).includes(stored)) {
    return stored as T;
  }
  return undefined;
}
