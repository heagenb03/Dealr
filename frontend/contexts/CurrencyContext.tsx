import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/services/firebaseService';
import { useAuth } from '@/contexts/AuthContext';
import {
  CurrencyCode,
  CurrencyMeta,
  SUPPORTED_CURRENCIES,
  DEFAULT_CURRENCY,
} from '@/constants/Currencies';
import {
  PREF_KEYS,
  readPref,
  writePref,
  ensureLegacyPrefsPurged,
  seedPrefIfAbsent,
  resolveEnumPref,
} from '@/services/userPrefsService';
import { getDefaultCashUnit } from '@/constants/CashUnits';
import {
  compactAmountFrom,
  compactThreshold,
  FLAT_COMPACT_THRESHOLD,
} from '@/utils/compactAmount';

const CURRENCY_CODES = Object.keys(SUPPORTED_CURRENCIES) as CurrencyCode[];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CurrencyContextType {
  currency: CurrencyCode;
  meta: CurrencyMeta;
  setCurrency: (code: CurrencyCode) => Promise<void>;
  /** Full locale-formatted amount, e.g. "$1,234.56", "¥1,235", "1.234,56 €" */
  formatAmount: (value: number) => string;
  /**
   * Compact stat format at a flat 1,000 threshold, e.g. "$1.2k", "￥1.2k".
   * For summary and profile tiles, which show computed totals at a glance.
   */
  formatAmountCompact: (value: number) => string;
  /**
   * Compact format whose threshold scales with the currency's smallest banknote
   * (JPY does not truncate until ￥200,000). For the collapsed Settings row,
   * which echoes a value the host chose — see docs/superpowers/specs/
   * 2026-08-10-compact-amount-formatting-design.md.
   */
  formatAmountCompactScaled: (value: number) => string;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const { user, userDoc } = useAuth();
  const uid = user?.uid;

  // Resolve starting currency: userDoc > this account's local copy (in effect)
  const [currency, setCurrencyState] = useState<CurrencyCode>(DEFAULT_CURRENCY);

  // Drop the previous account's currency DURING RENDER so no child ever formats
  // an amount in a currency belonging to a different account. Keyed on `uid`
  // alone — `userDoc` gets a new identity on every Firestore snapshot for the
  // same user and goes transiently null while offline.
  const lastUidRef = useRef<string | undefined>(uid);
  if (lastUidRef.current !== uid) {
    lastUidRef.current = uid;
    setCurrencyState(DEFAULT_CURRENCY);
  }

  // On auth change: read from this account's userDoc first, then its local copy
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      ensureLegacyPrefsPurged();
      // Signed out: stay on the default and read no account's preference.
      if (!uid) return;
      const stored = await readPref(PREF_KEYS.currency, uid);
      // Guard against a fast account switch resolving out of order.
      if (cancelled) return;
      const resolved = resolveEnumPref<CurrencyCode>(userDoc?.currency, stored, CURRENCY_CODES);
      setCurrencyState(resolved ?? DEFAULT_CURRENCY);
      // Keep an offline copy of a doc-supplied currency for this account — see
      // seedPrefIfAbsent for why purging the legacy key needs this to be lossless.
      await seedPrefIfAbsent(PREF_KEYS.currency, uid, stored, resolved);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [uid, userDoc]);

  const setCurrency = useCallback(async (code: CurrencyCode) => {
    setCurrencyState(code);
    // Persist locally immediately (works offline)
    await writePref(PREF_KEYS.currency, uid, code);
    // Sync to Firestore if signed in
    if (uid) {
      try {
        await updateDoc(doc(db, 'users', uid), { currency: code });
      } catch {
        // Offline or permission failure — the per-account local copy stands in
      }
    }
  }, [uid]);

  const meta = SUPPORTED_CURRENCIES[currency];

  // One formatter per currency, not one per call. PlayerCardActive calls
  // formatAmount 4x per card, so a 50-player active screen constructed ~200 of
  // these per mount. `meta` is a stable module constant per code, so this
  // rebuilds only on a real currency change.
  //
  // Construction can throw on a runtime with limited Intl support, and it now
  // happens during render — so it is caught here and degrades to null rather
  // than taking the whole provider down. `.format()` keeps its own catch.
  const numberFormat = useMemo<Intl.NumberFormat | null>(() => {
    try {
      return new Intl.NumberFormat(meta.locale, {
        style: 'currency',
        currency: meta.code,
        minimumFractionDigits: meta.decimals,
        maximumFractionDigits: meta.decimals,
      });
    } catch {
      return null;
    }
  }, [meta]);

  // Second formatter, for the already-divided value in a compact result.
  // Fraction digits are pinned 0-1 REGARDLESS of meta.decimals: JPY is a
  // 0-decimal currency, and inheriting that would round ￥200,500 to "￥201k"
  // instead of "￥200.5k". Same try/catch degradation as numberFormat above —
  // construction happens during render and can throw on a limited-Intl runtime.
  const scaledNumberFormat = useMemo<Intl.NumberFormat | null>(() => {
    try {
      return new Intl.NumberFormat(meta.locale, {
        style: 'currency',
        currency: meta.code,
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      });
    } catch {
      return null;
    }
  }, [meta]);

  const formatAmount = useCallback((value: number): string => {
    if (numberFormat) {
      try {
        return numberFormat.format(value);
      } catch {
        // fall through to the symbol fallback below
      }
    }
    return `${meta.symbol}${value.toFixed(meta.decimals)}`;
  }, [numberFormat, meta]);

  // Renders an already-scaled value (e.g. 1.5 for "1.5k"). Falls back to a bare
  // symbol prefix if Intl is unavailable, so a missing Intl cannot take the
  // provider down. Not locale-correct in that path — nothing is.
  const formatScaled = useCallback((scaled: number): string => {
    if (scaledNumberFormat) {
      try {
        return scaledNumberFormat.format(scaled);
      } catch {
        // fall through
      }
    }
    return `${meta.symbol}${scaled}`;
  }, [scaledNumberFormat, meta]);

  const formatAmountCompact = useCallback(
    (value: number): string =>
      compactAmountFrom(value, FLAT_COMPACT_THRESHOLD, formatAmount, formatScaled),
    [formatAmount, formatScaled],
  );

  // Threshold depends only on the currency code, so it is memoized rather than
  // recomputed per call — formatAmountCompact runs 3x per summary card, so a
  // 50-player summary is ~150 calls per mount.
  const scaledThreshold = useMemo(
    () => compactThreshold(getDefaultCashUnit(currency)),
    [currency],
  );

  const formatAmountCompactScaled = useCallback(
    (value: number): string =>
      compactAmountFrom(value, scaledThreshold, formatAmount, formatScaled),
    [scaledThreshold, formatAmount, formatScaled],
  );

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        meta,
        setCurrency,
        formatAmount,
        formatAmountCompact,
        formatAmountCompactScaled,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextType {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
