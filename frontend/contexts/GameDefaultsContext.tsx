import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/services/firebaseService';
import { useAuth } from '@/contexts/AuthContext';

const CASH_UNIT_KEY = 'cc.defaultCashUnit';
const MODE_KEY = 'cc.defaultSettlementMode';

type SettlementMode = 'optimal' | 'banker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GameDefaultsContextType {
  /** User-preferred rounding unit for new games. Undefined = use the currency's default note. */
  defaultCashUnit: number | undefined;
  /** User-preferred settlement mode for new games. Undefined = 'optimal'. */
  defaultSettlementMode: SettlementMode | undefined;
  setDefaultCashUnit: (unit: number) => Promise<void>;
  setDefaultSettlementMode: (mode: SettlementMode) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const GameDefaultsContext = createContext<GameDefaultsContextType | undefined>(undefined);

export function GameDefaultsProvider({ children }: { children: ReactNode }) {
  const { user, userDoc } = useAuth();

  const [defaultCashUnit, setCashUnitState] = useState<number | undefined>(undefined);
  const [defaultSettlementMode, setModeState] = useState<SettlementMode | undefined>(undefined);

  // On mount / auth change: read from userDoc first, then AsyncStorage for
  // whatever userDoc did not supply. Mirrors CurrencyContext.
  useEffect(() => {
    const load = async () => {
      const docUnit = (userDoc as any)?.defaultCashUnit;
      const docMode = (userDoc as any)?.defaultSettlementMode;
      let unitResolved = false;
      let modeResolved = false;
      if (typeof docUnit === 'number') {
        setCashUnitState(docUnit);
        unitResolved = true;
      }
      if (docMode === 'optimal' || docMode === 'banker') {
        setModeState(docMode);
        modeResolved = true;
      }
      try {
        if (!unitResolved) {
          const stored = await AsyncStorage.getItem(CASH_UNIT_KEY);
          if (stored !== null) {
            const n = parseInt(stored, 10);
            if (Number.isFinite(n)) setCashUnitState(n);
          }
        }
        if (!modeResolved) {
          const storedMode = await AsyncStorage.getItem(MODE_KEY);
          if (storedMode === 'optimal' || storedMode === 'banker') setModeState(storedMode);
        }
      } catch {
        // ignore storage errors — stay unset
      }
    };
    load();
  }, [userDoc]);

  const setDefaultCashUnit = useCallback(async (unit: number) => {
    setCashUnitState(unit);
    try {
      await AsyncStorage.setItem(CASH_UNIT_KEY, String(unit));
    } catch {
      // ignore
    }
    if (user) {
      try {
        await updateDoc(doc(db, 'users', user.uid), { defaultCashUnit: unit });
      } catch {
        // offline or permission failure — AsyncStorage copy is the source of truth
      }
    }
  }, [user]);

  const setDefaultSettlementMode = useCallback(async (mode: SettlementMode) => {
    setModeState(mode);
    try {
      await AsyncStorage.setItem(MODE_KEY, mode);
    } catch {
      // ignore
    }
    if (user) {
      try {
        await updateDoc(doc(db, 'users', user.uid), { defaultSettlementMode: mode });
      } catch {
        // offline or permission failure — AsyncStorage copy is the source of truth
      }
    }
  }, [user]);

  return (
    <GameDefaultsContext.Provider
      value={{ defaultCashUnit, defaultSettlementMode, setDefaultCashUnit, setDefaultSettlementMode }}
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
