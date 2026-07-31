import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PREF_KEYS,
  LEGACY_PREF_KEYS,
  prefKeyFor,
  readPref,
  writePref,
  purgeLegacyPrefKeys,
  resolveFloatPref,
  resolveIntPref,
  resolveEnumPref,
} from '@/services/userPrefsService';

const UID_A = 'uid_account_a';
const UID_B = 'uid_account_b';

beforeEach(async () => {
  await AsyncStorage.clear();
});

// ---------------------------------------------------------------------------
// Key namespacing
// ---------------------------------------------------------------------------

describe('prefKeyFor', () => {
  it('namespaces a preference key by uid', () => {
    expect(prefKeyFor(PREF_KEYS.defaultBuyIn, UID_A)).toBe(`cc.defaultBuyIn:${UID_A}`);
  });

  it('produces a distinct key per account', () => {
    expect(prefKeyFor(PREF_KEYS.defaultBuyIn, UID_A)).not.toBe(
      prefKeyFor(PREF_KEYS.defaultBuyIn, UID_B)
    );
  });

  it('never collides with the legacy device-global key', () => {
    for (const base of LEGACY_PREF_KEYS) {
      expect(prefKeyFor(base, UID_A)).not.toBe(base);
    }
  });
});

// ---------------------------------------------------------------------------
// THE REPORTED BUG: account A's defaults must not reach account B.
// ---------------------------------------------------------------------------

describe('cross-account isolation (regression: bug-364)', () => {
  it.each(Object.values(PREF_KEYS))(
    'does not leak %s from account A to account B',
    async (base) => {
      await writePref(base, UID_A, '20');
      expect(await readPref(base, UID_B)).toBeNull();
    }
  );

  it('resolves to undefined for B when only A has a stored default buy-in', async () => {
    await writePref(PREF_KEYS.defaultBuyIn, UID_A, '20');
    // B's userDoc carries no defaultBuyIn — the exact reported scenario.
    const storedForB = await readPref(PREF_KEYS.defaultBuyIn, UID_B);
    expect(resolveFloatPref(undefined, storedForB)).toBeUndefined();
  });

  it('still resolves A back to A', async () => {
    await writePref(PREF_KEYS.defaultBuyIn, UID_A, '20');
    expect(resolveFloatPref(undefined, await readPref(PREF_KEYS.defaultBuyIn, UID_A))).toBe(20);
  });

  it('keeps two accounts on the same device independently set', async () => {
    await writePref(PREF_KEYS.defaultBuyIn, UID_A, '20');
    await writePref(PREF_KEYS.defaultBuyIn, UID_B, '5');
    expect(await readPref(PREF_KEYS.defaultBuyIn, UID_A)).toBe('20');
    expect(await readPref(PREF_KEYS.defaultBuyIn, UID_B)).toBe('5');
  });
});

// ---------------------------------------------------------------------------
// Signed-out reads/writes touch no account bucket
// ---------------------------------------------------------------------------

describe('signed-out access', () => {
  it('reads nothing when there is no uid', async () => {
    await writePref(PREF_KEYS.defaultBuyIn, UID_A, '20');
    expect(await readPref(PREF_KEYS.defaultBuyIn, undefined)).toBeNull();
  });

  it('writes nothing when there is no uid', async () => {
    await writePref(PREF_KEYS.defaultBuyIn, undefined, '20');
    const all = await AsyncStorage.getAllKeys();
    expect(all).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Resolution — userDoc wins, then namespaced storage, then undefined.
// `0` is a LEGITIMATE stored value meaning "off"; truthiness checks destroy it.
// ---------------------------------------------------------------------------

describe('resolveFloatPref', () => {
  it('prefers the userDoc value over storage', () => {
    expect(resolveFloatPref(50, '20')).toBe(50);
  });

  it('preserves an explicit userDoc 0 (the off switch) over a stored value', () => {
    expect(resolveFloatPref(0, '20')).toBe(0);
  });

  it('preserves an explicit stored "0" (the off switch)', () => {
    expect(resolveFloatPref(undefined, '0')).toBe(0);
  });

  it('falls back to storage when the userDoc lacks the field', () => {
    expect(resolveFloatPref(undefined, '12.5')).toBe(12.5);
  });

  it('returns undefined when neither source has a value', () => {
    expect(resolveFloatPref(undefined, null)).toBeUndefined();
  });

  it('ignores a non-numeric userDoc value', () => {
    expect(resolveFloatPref('20', '5')).toBe(5);
  });

  it('ignores unparseable stored text', () => {
    expect(resolveFloatPref(undefined, 'twenty')).toBeUndefined();
  });

  it('ignores a non-finite userDoc value', () => {
    expect(resolveFloatPref(Number.NaN, null)).toBeUndefined();
  });
});

describe('resolveIntPref', () => {
  it('parses a stored integer', () => {
    expect(resolveIntPref(undefined, '25')).toBe(25);
  });

  it('preserves an explicit stored "0"', () => {
    expect(resolveIntPref(undefined, '0')).toBe(0);
  });

  it('prefers the userDoc value', () => {
    expect(resolveIntPref(100, '25')).toBe(100);
  });

  it('returns undefined when absent', () => {
    expect(resolveIntPref(undefined, null)).toBeUndefined();
  });
});

describe('resolveEnumPref', () => {
  const MODES = ['optimal', 'banker'] as const;

  it('prefers a valid userDoc value', () => {
    expect(resolveEnumPref('banker', 'optimal', MODES)).toBe('banker');
  });

  it('falls back to a valid stored value', () => {
    expect(resolveEnumPref(undefined, 'banker', MODES)).toBe('banker');
  });

  it('rejects a value outside the allowed set', () => {
    expect(resolveEnumPref('greedy', 'greedy', MODES)).toBeUndefined();
  });

  it('returns undefined when absent', () => {
    expect(resolveEnumPref(undefined, null, MODES)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Legacy purge — the shared device-global keys are dropped, not migrated.
// Migrating them would hand account A's value to whoever signs in first,
// which is the reported bug all over again.
// ---------------------------------------------------------------------------

describe('purgeLegacyPrefKeys', () => {
  it('removes every legacy device-global key', async () => {
    for (const key of LEGACY_PREF_KEYS) {
      await AsyncStorage.setItem(key, '20');
    }
    await purgeLegacyPrefKeys();
    for (const key of LEGACY_PREF_KEYS) {
      expect(await AsyncStorage.getItem(key)).toBeNull();
    }
  });

  it('leaves namespaced per-account keys untouched', async () => {
    await AsyncStorage.setItem(PREF_KEYS.defaultBuyIn, '20');
    await writePref(PREF_KEYS.defaultBuyIn, UID_A, '5');
    await purgeLegacyPrefKeys();
    expect(await readPref(PREF_KEYS.defaultBuyIn, UID_A)).toBe('5');
  });

  it('leaves unrelated device-scoped keys untouched', async () => {
    await AsyncStorage.setItem('review_install_date', '123');
    await AsyncStorage.setItem('cc.intro_seen', '1');
    await purgeLegacyPrefKeys();
    expect(await AsyncStorage.getItem('review_install_date')).toBe('123');
    expect(await AsyncStorage.getItem('cc.intro_seen')).toBe('1');
  });

  it('is idempotent and safe when nothing is stored', async () => {
    await expect(purgeLegacyPrefKeys()).resolves.toBeUndefined();
    await expect(purgeLegacyPrefKeys()).resolves.toBeUndefined();
  });
});
