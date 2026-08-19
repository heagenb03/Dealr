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
import { createCurrencyFormatters } from '@/utils/currencyFormat';

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

  // One formatter bundle per currency, not one per call. PlayerCardActive calls
  // formatAmount 4x per card, so a 50-player active screen would otherwise
  // construct ~200 Intl.NumberFormats per mount. `currency` is a plain string, so
  // this rebuilds only on a real currency change.
  //
  // Construction can throw on a runtime with limited Intl support, and it happens
  // during render — createCurrencyFormatters catches it internally and degrades
  // to a symbol-prefix fallback rather than taking the whole provider down.
  const { meta, formatAmount, formatAmountCompact, formatAmountCompactScaled } = useMemo(
    () => createCurrencyFormatters(currency),
    [currency],
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
