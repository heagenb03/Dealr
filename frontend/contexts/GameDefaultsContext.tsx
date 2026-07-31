import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/services/firebaseService';
import { useAuth } from '@/contexts/AuthContext';
import {
  PREF_KEYS,
  readPref,
  writePref,
  ensureLegacyPrefsPurged,
  resolveIntPref,
  resolveFloatPref,
  resolveEnumPref,
} from '@/services/userPrefsService';

type SettlementMode = 'optimal' | 'banker';

const SETTLEMENT_MODES: readonly SettlementMode[] = ['optimal', 'banker'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GameDefaultsContextType {
  /** User-preferred rounding unit for new games. Undefined = use the currency's default note. */
  defaultCashUnit: number | undefined;
  /** User-preferred settlement mode for new games. Undefined = 'optimal'. */
  defaultSettlementMode: SettlementMode | undefined;
  /** User-preferred imbalance tolerance for new games (native currency units). Undefined = currency default. */
  defaultTolerance: number | undefined;
  /** User-preferred default buy-in for new games (native currency units). Undefined or 0 = off. */
  defaultBuyIn: number | undefined;
  setDefaultCashUnit: (unit: number) => Promise<void>;
  setDefaultSettlementMode: (mode: SettlementMode) => Promise<void>;
  setDefaultTolerance: (tolerance: number) => Promise<void>;
  setDefaultBuyIn: (amount: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const GameDefaultsContext = createContext<GameDefaultsContextType | undefined>(undefined);

export function GameDefaultsProvider({ children }: { children: ReactNode }) {
  const { user, userDoc } = useAuth();
  const uid = user?.uid;

  const [defaultCashUnit, setCashUnitState] = useState<number | undefined>(undefined);
  const [defaultSettlementMode, setModeState] = useState<SettlementMode | undefined>(undefined);
  const [defaultTolerance, setToleranceState] = useState<number | undefined>(undefined);
  const [defaultBuyIn, setBuyInState] = useState<number | undefined>(undefined);

  // Clear the previous account's defaults DURING RENDER, not in an effect.
  // GameContext stamps these four values onto every new game, so an async reset
  // leaves a window in which the incoming user could create a game carrying the
  // previous user's values — and once stamped they are persisted into the game
  // document, which is far worse than a transient UI flash. Adjusting state in
  // render means no child ever observes the stale value.
  //
  // Keyed on `uid` and nothing else: `userDoc` gets a fresh object identity on
  // every Firestore snapshot for the SAME user (and goes transiently null on
  // the offline/missing-doc paths), so keying on it would blank the defaults
  // repeatedly mid-session.
  const lastUidRef = useRef<string | undefined>(uid);
  if (lastUidRef.current !== uid) {
    lastUidRef.current = uid;
    setCashUnitState(undefined);
    setModeState(undefined);
    setToleranceState(undefined);
    setBuyInState(undefined);
  }

  // Resolve each value: this account's Firestore user doc first, then this
  // account's locally cached copy for whatever the doc did not supply.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // One-time hygiene: drop the pre-account-scoping device-global keys.
      ensureLegacyPrefsPurged();

      // Signed out: hold "unset" and read no account's preferences.
      if (!uid) return;

      const [storedUnit, storedMode, storedTol, storedBuyIn] = await Promise.all([
        readPref(PREF_KEYS.defaultCashUnit, uid),
        readPref(PREF_KEYS.defaultSettlementMode, uid),
        readPref(PREF_KEYS.defaultTolerance, uid),
        readPref(PREF_KEYS.defaultBuyIn, uid),
      ]);
      // A fast account switch can resolve this read after the next account's
      // reset has already run — dropping it here is what keeps A's value from
      // landing on top of B.
      if (cancelled) return;

      setCashUnitState(resolveIntPref(userDoc?.defaultCashUnit, storedUnit));
      setModeState(resolveEnumPref(userDoc?.defaultSettlementMode, storedMode, SETTLEMENT_MODES));
      setToleranceState(resolveFloatPref(userDoc?.defaultTolerance, storedTol));
      setBuyInState(resolveFloatPref(userDoc?.defaultBuyIn, storedBuyIn));
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [uid, userDoc]);

  const setDefaultCashUnit = useCallback(async (unit: number) => {
    setCashUnitState(unit);
    await writePref(PREF_KEYS.defaultCashUnit, uid, String(unit));
    if (uid) {
      try {
        await updateDoc(doc(db, 'users', uid), { defaultCashUnit: unit });
      } catch {
        // offline or permission failure — the per-account local copy stands in
      }
    }
  }, [uid]);

  const setDefaultSettlementMode = useCallback(async (mode: SettlementMode) => {
    setModeState(mode);
    await writePref(PREF_KEYS.defaultSettlementMode, uid, mode);
    if (uid) {
      try {
        await updateDoc(doc(db, 'users', uid), { defaultSettlementMode: mode });
      } catch {
        // offline or permission failure — the per-account local copy stands in
      }
    }
  }, [uid]);

  const setDefaultTolerance = useCallback(async (tolerance: number) => {
    setToleranceState(tolerance);
    await writePref(PREF_KEYS.defaultTolerance, uid, String(tolerance));
    if (uid) {
      try {
        await updateDoc(doc(db, 'users', uid), { defaultTolerance: tolerance });
      } catch {
        // offline or permission failure — the per-account local copy stands in
      }
    }
  }, [uid]);

  const setDefaultBuyIn = useCallback(async (amount: number) => {
    setBuyInState(amount);
    await writePref(PREF_KEYS.defaultBuyIn, uid, String(amount));
    if (uid) {
      try {
        await updateDoc(doc(db, 'users', uid), { defaultBuyIn: amount });
      } catch {
        // offline or permission failure — the per-account local copy stands in
      }
    }
  }, [uid]);

  return (
    <GameDefaultsContext.Provider
      value={{
        defaultCashUnit,
        defaultSettlementMode,
        defaultTolerance,
        defaultBuyIn,
        setDefaultCashUnit,
        setDefaultSettlementMode,
        setDefaultTolerance,
        setDefaultBuyIn,
      }}
    >
      {children}
    </GameDefaultsContext.Provider>
  );
}

export function useGameDefaults(): GameDefaultsContextType {
  const context = useContext(GameDefaultsContext);
  if (context === undefined) {
    throw new Error('useGameDefaults must be used within a GameDefaultsProvider');
  }
  return context;
}
