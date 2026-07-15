import { initializeApp, getApps } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCredential,
  linkWithCredential,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
  GoogleAuthProvider,
  OAuthProvider,
  User,
} from 'firebase/auth';
// getReactNativePersistence is exported at runtime via Metro's react-native
// condition but is absent from firebase/auth's TypeScript types in SDK 12.
// @ts-ignore
import { getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  initializeFirestore,
  persistentLocalCache,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  collection,
  serverTimestamp,
  increment,
  runTransaction,
} from 'firebase/firestore';
import { Game } from '@/types/game';
import type { SavedPlayer } from '@/services/savedPlayersService';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { TRIAL_DURATION_DAYS } from '@/utils/trialUtils';

// ---------------------------------------------------------------------------
// Firebase config — values come from environment variables.
// Set these in frontend/.env.local before running:
//   EXPO_PUBLIC_FIREBASE_API_KEY=...
//   EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
//   EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
//   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=...
//   EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
//   EXPO_PUBLIC_FIREBASE_APP_ID=...
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Prevent duplicate initialization in dev hot-reload
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Firebase Functions instance
const firebaseFunctions = getFunctions(app);

// Auth — explicitly configured with AsyncStorage persistence so auth state
// survives app restarts. Required for React Native (in-memory is the default).
// initializeAuth throws if called twice (e.g. hot-reload) — fall back to getAuth.
export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
})();

// Firestore — enable offline persistence with the modular localCache API
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});

// Suppress the raw Firebase offline warning — the app handles offline state
// gracefully via NetworkContext and the offline strip in the tab header, so this noisy log is not useful.
const _originalWarn = console.warn;
console.warn = (...args: any[]) => {
  if (
    typeof args[0] === 'string' &&
    args[0].includes('@firebase/firestore') &&
    args[0].includes('Could not reach Cloud Firestore backend')
  ) {
    return;
  }
  _originalWarn.apply(console, args);
};

// ---------------------------------------------------------------------------
// User document helpers
// ---------------------------------------------------------------------------

/** Create the /users/{uid} document on first sign-in.
 *  Retries on permission-denied to handle the token propagation delay that
 *  occurs immediately after createUserWithEmailAndPassword. */
export async function createUserDocument(
  user: User,
  displayName?: string,
  attempt = 0,
): Promise<void> {
  try {
    const userRef = doc(db, 'users', user.uid);
    const snapshot = await getDoc(userRef);
    if (snapshot.exists()) return;

    await setDoc(userRef, {
      displayName: displayName ?? user.displayName ?? '',
      email: user.email ?? '',
      photoURL: user.photoURL ?? null,
      createdAt: serverTimestamp(),
      tier: 'free',
      totalGamesPlayed: 0,
      totalMoneyTracked: 0,
      totalPlayersHosted: 0,
      biggestPot: 0,
      proSince: null,
      trialEndsAt: new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000),
      currency: 'USD',
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied' && attempt < 4) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      return createUserDocument(user, displayName, attempt + 1);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Email / Password
// ---------------------------------------------------------------------------

export async function signUpWithEmail(
  name: string,
  email: string,
  password: string,
): Promise<User> {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(user, { displayName: name });
  // Force a token refresh so Firestore security rules recognise the new uid
  // before we attempt to write the user document.
  await user.getIdToken(true);
  await createUserDocument(user, name);
  return user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const { user } = await signInWithEmailAndPassword(auth, email, password);
  // Safety net: create the user doc if it's missing (e.g. signup doc creation
  // failed due to token propagation). This is a no-op if the doc already exists.
  await createUserDocument(user);
  return user;
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

/** Send a verification email to the currently signed-in user. */
export async function sendVerificationEmail(): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No authenticated user');
  await sendEmailVerification(currentUser);
}

// ---------------------------------------------------------------------------
// Google Sign-In
// Uses Firebase credential built from an ID token obtained via expo-auth-session.
// Pass the idToken returned by the Google OAuth flow.
// ---------------------------------------------------------------------------

export async function signInWithGoogleCredential(idToken: string): Promise<User> {
  const credential = GoogleAuthProvider.credential(idToken);
  const result = await signInWithCredential(auth, credential);
  // Ensure the Firestore user doc exists. NOT gated on isNewUser: the modular
  // SDK's UserCredential has no `additionalUserInfo` property (that data is only
  // reachable via getAdditionalUserInfo), so the old gate never fired and Google
  // accounts never got a doc. createUserDocument is a no-op if it already exists.
  await createUserDocument(result.user);
  return result.user;
}

// ---------------------------------------------------------------------------
// Apple Sign-In
// Pass the identityToken returned by expo-apple-authentication.
// The optional fullName is only available on the first Apple sign-in.
// ---------------------------------------------------------------------------

export async function signInWithAppleCredential(
  identityToken: string,
  fullName?: string | null,
): Promise<User> {
  const provider = new OAuthProvider('apple.com');
  const credential = provider.credential({ idToken: identityToken });
  const result = await signInWithCredential(auth, credential);

  // Apple only returns the full name on the first sign-in — store it if present.
  if (fullName) {
    await updateProfile(result.user, { displayName: fullName });
  }
  // Ensure the Firestore user doc exists. NOT gated on isNewUser: the modular
  // SDK's UserCredential has no `additionalUserInfo` property, so the old gate
  // never fired and Apple accounts never got a doc. No-op if it already exists.
  await createUserDocument(result.user, fullName ?? undefined);

  return result.user;
}

// ---------------------------------------------------------------------------
// Account linking (Tier B)
// Adds an OAuth provider to the ALREADY signed-in user. Under the project's
// one-account-per-email + email-enumeration-protection config this is the only
// reliable linking primitive (see firebase-auth-linking-constraints memory).
// Email/password linking is intentionally unsupported (no add-password flow).
// linkAppleCredential does NOT set displayName — linking must not overwrite the
// existing account's name.
// ---------------------------------------------------------------------------

export async function linkGoogleCredential(idToken: string): Promise<User> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No authenticated user');
  const credential = GoogleAuthProvider.credential(idToken);
  const result = await linkWithCredential(currentUser, credential);
  return result.user;
}

export async function linkAppleCredential(identityToken: string): Promise<User> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No authenticated user');
  const provider = new OAuthProvider('apple.com');
  const credential = provider.credential({ idToken: identityToken });
  const result = await linkWithCredential(currentUser, credential);
  return result.user;
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

export async function firebaseSignOut(): Promise<void> {
  await signOut(auth);
}

// ---------------------------------------------------------------------------
// Profile management
// ---------------------------------------------------------------------------

/**
 * Update display name in Firebase Auth profile and Firestore user document.
 */
export async function updateDisplayName(name: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No authenticated user');

  await updateProfile(currentUser, { displayName: name });
  await updateDoc(doc(db, 'users', currentUser.uid), { displayName: name });
}

/**
 * Change the current user's password.
 * May throw auth/requires-recent-login if the session is too old.
 */
export async function updateUserPassword(newPassword: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No authenticated user');

  await updatePassword(currentUser, newPassword);
}

/**
 * Re-authenticate the current user with email + password.
 * Call this before sensitive operations (email change, password change, delete).
 */
export async function reauthenticateUser(email: string, password: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No authenticated user');

  const credential = EmailAuthProvider.credential(email, password);
  await reauthenticateWithCredential(currentUser, credential);
}

/**
 * Delete the current Firebase Auth user.
 * Firestore data deletion is handled by the deleteUserData Cloud Function.
 */
export async function deleteCurrentUser(): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('No authenticated user');

  await deleteUser(currentUser);
}

// ---------------------------------------------------------------------------
// Profile Stats
// ---------------------------------------------------------------------------

/**
 * Increment profile stat counters and raise biggestPot on the user document.
 *
 * Split into two writes on purpose: the three counters use offline-durable
 * `updateDoc(...increment())` writes, which Firestore serves from cache and
 * queues in the offline write buffer. `biggestPot` needs a read-modify-write
 * for `max` (no offline-safe FieldValue sentinel exists for that), so it is
 * isolated in its own `runTransaction` call — transactions require a live
 * server round-trip and are NOT queued offline. The counters are written
 * first so they persist even if the game completes offline and the
 * biggestPot transaction rejects.
 */
export async function incrementProfileStats(
  uid: string,
  stats: { gamesPlayed: number; moneyTracked: number; playersHosted: number; gamePot: number },
): Promise<void> {
  const userRef = doc(db, 'users', uid);

  // Offline-durable: cached locally and queued for sync if there's no connection.
  await updateDoc(userRef, {
    totalGamesPlayed: increment(stats.gamesPlayed),
    totalMoneyTracked: increment(stats.moneyTracked),
    totalPlayersHosted: increment(stats.playersHosted),
  });

  // Online-only: requires a live read-modify-write, so it runs after and
  // separately from the counters so its failure doesn't lose them.
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const currentBiggest =
      typeof snapshot.data()?.biggestPot === 'number'
        ? (snapshot.data()!.biggestPot as number)
        : 0;
    transaction.update(userRef, { biggestPot: Math.max(currentBiggest, stats.gamePot) });
  });
}

/** Update the user's preferred currency code. */
export async function updateUserCurrency(uid: string, currencyCode: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { currency: currencyCode });
}

/** Set proSince timestamp on the user document (only if not already set). */
export async function setProSince(uid: string): Promise<void> {
  const userRef = doc(db, 'users', uid);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (snapshot.exists() && !snapshot.data().proSince) {
      transaction.update(userRef, { proSince: serverTimestamp() });
    }
  });
}

// ---------------------------------------------------------------------------
// Game Sync — Firestore CRUD for /users/{uid}/games/{gameId}
// ---------------------------------------------------------------------------

/**
 * Write a game to Firestore under /users/{uid}/games/{gameId}.
 * Uses setDoc with merge so partial updates don't overwrite unrelated fields.
 * Settlement cache is excluded — it's ephemeral and re-fetchable on demand.
 * Adds syncedAt server timestamp for last-write-wins conflict resolution.
 */
export async function saveGameToFirestore(uid: string, game: Game): Promise<void> {
  const gameRef = doc(db, 'users', uid, 'games', game.id);
  // Exclude ephemeral cache fields that don't belong in remote storage
  const { cachedSettlements, transactionHash, syncedAt: _syncedAt, ...gameData } = game;
  // Firestore rejects `undefined` values — strip them recursively
  // (e.g. completedAt on active games/players, optional fields on new objects)
  await setDoc(gameRef, { ...stripUndefined(gameData), syncedAt: serverTimestamp() }, { merge: true });
}

/** Recursively remove keys with `undefined` values from an object/array. */
function stripUndefined(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(stripUndefined);
  }
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        clean[key] = stripUndefined(value);
      }
    }
    return clean;
  }
  return obj;
}

/**
 * Delete a game document from Firestore.
 */
export async function deleteGameFromFirestore(uid: string, gameId: string): Promise<void> {
  const gameRef = doc(db, 'users', uid, 'games', gameId);
  await deleteDoc(gameRef);
}

/**
 * Fetch all games for a user from Firestore.
 * Converts Firestore Timestamps back to JS Dates.
 */
export async function fetchGamesFromFirestore(uid: string): Promise<Game[]> {
  const gamesRef = collection(db, 'users', uid, 'games');
  const snapshot = await getDocs(gamesRef);
  return snapshot.docs.map(docSnap => deserializeFirestoreGame(docSnap.data()));
}

/** Convert a Firestore document (with Timestamps) back to a typed Game. */
export function deserializeFirestoreGame(data: Record<string, any>): Game {
  const toDate = (v: any): Date => (v?.toDate ? v.toDate() : new Date(v));
  const toOptDate = (v: any): Date | undefined => (v ? toDate(v) : undefined);

  return {
    id: data.id,
    name: data.name,
    date: toDate(data.date),
    status: data.status,
    players: (data.players ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      completedAt: toOptDate(p.completedAt),
      preferredPayment: p.preferredPayment,
      savedPlayerId: p.savedPlayerId,
    })),
    transactions: (data.transactions ?? []).map((t: any) => ({
      ...t,
      timestamp: toDate(t.timestamp),
    })),
    createdAt: toDate(data.createdAt),
    syncedAt: toOptDate(data.syncedAt),
    cashUnit: data.cashUnit,
    currency: data.currency,
    settlementMode: data.settlementMode,
    bankerPlayerId: data.bankerPlayerId,
  };
}

// ---------------------------------------------------------------------------
// Cloud Functions
// ---------------------------------------------------------------------------

/**
 * Call the deleteUserData Cloud Function which recursively deletes all
 * Firestore data under /users/{uid} and then deletes the Auth user.
 *
 * TODO Phase 1B: Deploy the Cloud Function (see functions/src/index.ts)
 * before calling this in production.
 */
export async function callDeleteUserData(): Promise<void> {
  const deleteUserData = httpsCallable(firebaseFunctions, 'deleteUserData');
  await deleteUserData({});
}

// ---------------------------------------------------------------------------
// Offline error detection (shared by the games + saved-players sync layers)
// ---------------------------------------------------------------------------

/**
 * Returns true when the error is a known Firestore "device is offline" error.
 * Expected when the user has no connection; the app is offline-first so these
 * are swallowed to a debug log rather than surfaced.
 */
export function isFirestoreOfflineError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const code = (err as any).code;
    const message = (err as any).message ?? '';
    if (code === 'unavailable') return true;
    if (typeof message === 'string' && message.includes('Could not reach Cloud Firestore backend')) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Saved Players Sync — single doc at /users/{uid}/savedPlayers/list
// ---------------------------------------------------------------------------

const SAVED_PLAYERS_DOC = 'list';

/** id -> deletedAt (epoch ms); a delete that must survive a stale-remote merge. */
type SavedPlayerTombstones = Record<string, number>;

/** The saved-players doc payload: the list plus deletion tombstones. */
export interface SavedPlayersDoc {
  players: SavedPlayer[];
  tombstones: SavedPlayerTombstones;
}

/**
 * Write the full saved-players list (and deletion tombstones) to
 * /users/{uid}/savedPlayers/list. Tombstones let a delete survive the offline-first
 * union merge — see savedPlayersService.unionMerge.
 */
export async function saveSavedPlayersToFirestore(
  uid: string,
  players: SavedPlayer[],
  tombstones: SavedPlayerTombstones = {},
): Promise<void> {
  const ref = doc(db, 'users', uid, 'savedPlayers', SAVED_PLAYERS_DOC);
  await setDoc(ref, { players: stripUndefined(players), tombstones, syncedAt: serverTimestamp() });
}

/** Fetch the saved-players doc (empty list + no tombstones when the doc is missing). */
export async function fetchSavedPlayersFromFirestore(uid: string): Promise<SavedPlayersDoc> {
  const ref = doc(db, 'users', uid, 'savedPlayers', SAVED_PLAYERS_DOC);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { players: [], tombstones: {} };
  const data = snap.data();
  const players = Array.isArray(data.players) ? (data.players as SavedPlayer[]) : [];
  const tombstones =
    data.tombstones && typeof data.tombstones === 'object' && !Array.isArray(data.tombstones)
      ? (data.tombstones as SavedPlayerTombstones)
      : {};
  return { players, tombstones };
}
