import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db, firebaseSignOut, createUserDocument } from '@/services/firebaseService';
import {
  initializePurchases,
  loginPurchases,
  logoutPurchases,
  getIsPro,
} from '@/services/revenueCatService';
import { isTrialActive, getTrialDaysRemaining } from '@/utils/trialUtils';

// Initialize RevenueCat once when this module loads
initializePurchases();

// ---------------------------------------------------------------------------
// DEV OVERRIDE — remove this block once RevenueCat is fully integrated
// Set to true to bypass subscription checks during testing.
// ---------------------------------------------------------------------------
const DEV_FORCE_PRO = __DEV__ && false;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tier = 'free' | 'pro';

interface UserDocument {
  displayName: string;
  email: string;
  photoURL: string | null;
  tier: Tier;
  totalGamesPlayed?: number;
  totalMoneyTracked?: number;
  totalPlayersHosted?: number;
  biggestPot?: number;
  proSince?: Date | null;
  trialEndsAt?: Date | null;
  createdAt?: Date | null;
  currency?: string;
}

interface AuthContextType {
  /** Firebase Auth user — null if signed out */
  user: User | null;
  /** Whether the current user's email is verified (reactive; survives reload()). */
  emailVerified: boolean;
  /** reload() the current user and refresh emailVerified. Never throws; returns the resulting verified state. */
  refreshVerification: () => Promise<boolean>;
  /** Firestore user document (tier, displayName, etc.) */
  userDoc: UserDocument | null;
  /** True until onAuthStateChanged fires for the first time — show splash, not auth screens */
  isLoading: boolean;
  /** Whether the user has a Pro subscription (Firestore tier OR RevenueCat entitlement OR active trial) */
  isPro: boolean;
  /** Whether the user is currently on a free trial (not paid Pro) */
  isTrialing: boolean;
  /** Number of full days remaining in the trial (0 if expired/not on trial) */
  trialDaysRemaining: number;
  /** Whether the user had a trial that has now expired (and they haven't upgraded) */
  trialExpired: boolean;
  signOut: () => Promise<void>;
  /** Re-fetch the Firestore user document (e.g., after tier changes) */
  refreshUserDoc: () => Promise<void>;
  /** Re-fetch RevenueCat entitlements (e.g., after a purchase or restore) */
  refreshEntitlements: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<UserDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [rcIsPro, setRcIsPro] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  const fetchUserDoc = async (uid: string, attempt = 0): Promise<void> => {
    try {
      const snapshot = await getDoc(doc(db, 'users', uid));
      if (snapshot.exists()) {
        const data = snapshot.data();
        setUserDoc({
          ...data,
          proSince: data.proSince?.toDate?.() ?? data.proSince ?? null,
          trialEndsAt: data.trialEndsAt?.toDate?.() ?? data.trialEndsAt ?? null,
          createdAt: data.createdAt?.toDate?.() ?? data.createdAt ?? null,
        } as UserDocument);
      } else {
        setUserDoc(null);
      }
    } catch (err: any) {
      // Device is offline — skip silently. The app is offline-first and the user
      // doc will be re-fetched once connectivity is restored.
      if (err?.code === 'unavailable') {
        console.debug('AuthContext: skipping user doc fetch — device offline');
        // Do NOT clear userDoc — preserve any previously loaded data so Pro/trial
        // state remains accurate while the user is offline.
        return;
      }
      // New users can briefly get permission-denied while Firebase propagates the
      // auth token to Firestore. Retry up to 4 times with exponential backoff.
      if (err?.code === 'permission-denied' && attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        return fetchUserDoc(uid, attempt + 1);
      }
      console.error('AuthContext: failed to fetch user doc', err);
      setUserDoc(null);
    }
  };

  const fetchRcEntitlements = async (): Promise<void> => {
    try {
      const proStatus = await getIsPro();
      setRcIsPro(proStatus);
    } catch (err) {
      console.error('AuthContext: failed to fetch RC entitlements', err);
    }
  };

  // Live subscription to /users/{uid} so stat/tier/trial changes reflect in the
  // UI without an app reload. Also self-heals a missing doc — e.g. an OAuth
  // account that never got one, or a brand-new user whose creation write has not
  // landed yet. Kept in refs so the onAuthStateChanged listener can tear it down.
  const userDocUnsubRef = useRef<null | (() => void)>(null);
  const healingRef = useRef(false);

  const applyUserDocSnapshot = (data: any): void => {
    setUserDoc({
      ...data,
      proSince: data.proSince?.toDate?.() ?? data.proSince ?? null,
      trialEndsAt: data.trialEndsAt?.toDate?.() ?? data.trialEndsAt ?? null,
      createdAt: data.createdAt?.toDate?.() ?? data.createdAt ?? null,
    } as UserDocument);
  };

  const subscribeUserDoc = (firebaseUser: User, attempt = 0): void => {
    // Tear down any previous listener before starting a new one.
    userDocUnsubRef.current?.();
    userDocUnsubRef.current = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snapshot) => {
        if (snapshot.exists()) {
          healingRef.current = false;
          applyUserDocSnapshot(snapshot.data());
          return;
        }
        // Doc missing — heal it once. The listener re-fires with the created doc.
        setUserDoc(null);
        if (healingRef.current) return;
        healingRef.current = true;
        createUserDocument(firebaseUser).catch((err) => {
          healingRef.current = false;
          console.error('AuthContext: failed to create missing user doc', err);
        });
      },
      (err: any) => {
        // New users can briefly get permission-denied while Firebase propagates
        // the auth token to Firestore — retry the subscription with backoff.
        if (err?.code === 'permission-denied' && attempt < 4) {
          setTimeout(() => subscribeUserDoc(firebaseUser, attempt + 1), 1000 * (attempt + 1));
          return;
        }
        // Offline — keep any previously loaded doc; the listener resumes on
        // reconnect. Do NOT clear userDoc.
        if (err?.code === 'unavailable') return;
        console.error('AuthContext: user doc listener error', err);
      },
    );
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setEmailVerified(firebaseUser?.emailVerified ?? false);

      if (firebaseUser) {
        // Start (or restart) the live user-doc subscription — this is what keeps
        // stats current without a reload and heals a missing doc on any app open.
        subscribeUserDoc(firebaseUser);
        // Initial load: one-shot fetch (so we don't render past the splash with a
        // null doc) plus RC entitlements, in parallel.
        await Promise.all([
          fetchUserDoc(firebaseUser.uid),
          (async () => {
            await loginPurchases(firebaseUser.uid);
            await fetchRcEntitlements();
          })(),
        ]);
        // Set install date once on first sign-in
        AsyncStorage.getItem('review_install_date').then(val => {
          if (!val) AsyncStorage.setItem('review_install_date', String(Date.now()));
        }).catch(() => {});
      } else {
        // Tear down the listener and clear state on sign-out.
        userDocUnsubRef.current?.();
        userDocUnsubRef.current = null;
        healingRef.current = false;
        setUserDoc(null);
        setRcIsPro(false);
        await logoutPurchases();
      }

      setIsLoading(false);
    });

    return () => {
      unsubscribe();
      userDocUnsubRef.current?.();
      userDocUnsubRef.current = null;
    };
  }, []);

  const handleSignOut = async (): Promise<void> => {
    await logoutPurchases();
    await firebaseSignOut();
    // State is cleared by the onAuthStateChanged listener above
  };

  const refreshUserDoc = async (): Promise<void> => {
    if (user) {
      await fetchUserDoc(user.uid);
    }
  };

  const refreshEntitlements = async (): Promise<void> => {
    await fetchRcEntitlements();
    // Also refresh the Firestore doc in case the webhook has already updated the tier
    if (user) {
      await fetchUserDoc(user.uid);
    }
  };

  // reload() rejects with auth/network-request-failed when offline. This is called
  // from the verify screen's AppState handler and its "I've verified" button, so it
  // must never throw — on failure it leaves emailVerified unchanged and reports the
  // last-known state, letting the screen show its offline/error state.
  const refreshVerification = useCallback(async (): Promise<boolean> => {
    const u = auth.currentUser;
    if (!u) return false;
    try {
      await u.reload();
      setEmailVerified(u.emailVerified);
      return u.emailVerified;
    } catch {
      return auth.currentUser?.emailVerified ?? false;
    }
  }, []);

  // Paid Pro: Firestore tier or RevenueCat entitlement
  const paidPro = userDoc?.tier === 'pro' || rcIsPro;

  // Trial: only active if user is not already a paid Pro subscriber
  // Counter incremented when the trial expires mid-session to force a re-render
  const [, setTrialExpiredTick] = useState(0);
  const trialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trialEndsAt = userDoc?.trialEndsAt ?? null;
  const isTrialing = !paidPro && isTrialActive(trialEndsAt);
  const trialDaysRemaining = getTrialDaysRemaining(trialEndsAt);

  // isPro is true if paid Pro, active trial, or dev override.
  const isPro = DEV_FORCE_PRO || paidPro || isTrialing;

  // trialExpired: had a trial, it's over, and user hasn't upgraded
  const trialExpired = !isTrialing && !!trialEndsAt && !paidPro;

  // Live trial expiry: schedule a re-render when the trial expires while the app is open
  useEffect(() => {
    if (trialTimerRef.current) {
      clearTimeout(trialTimerRef.current);
      trialTimerRef.current = null;
    }

    if (trialEndsAt && isTrialing) {
      const remaining = trialEndsAt.getTime() - Date.now();
      if (remaining > 0) {
        trialTimerRef.current = setTimeout(() => {
          setTrialExpiredTick(prev => prev + 1);
        }, remaining);
      }
    }

    return () => {
      if (trialTimerRef.current) {
        clearTimeout(trialTimerRef.current);
      }
    };
  }, [trialEndsAt, isTrialing]);

  return (
    <AuthContext.Provider
      value={{
        user,
        emailVerified,
        refreshVerification,
        userDoc,
        isLoading,
        isPro,
        isTrialing,
        trialDaysRemaining,
        trialExpired,
        signOut: handleSignOut,
        refreshUserDoc,
        refreshEntitlements,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
