// Firebase SDK is initialized at module scope in firebaseService, so every
// firebase entry point must be mocked before the module is imported.
jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(() => ({})),
  getApps: jest.fn(() => []),
}));
jest.mock('firebase/auth', () => ({
  initializeAuth: jest.fn(() => ({})),
  getAuth: jest.fn(() => ({})),
  getReactNativePersistence: jest.fn(() => ({})),
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signInWithCredential: jest.fn(),
  linkWithCredential: jest.fn(),
  signOut: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendEmailVerification: jest.fn(),
  updateProfile: jest.fn(),
  updatePassword: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
  EmailAuthProvider: { credential: jest.fn() },
  deleteUser: jest.fn(),
  GoogleAuthProvider: { credential: jest.fn(() => ({})) },
  OAuthProvider: jest.fn().mockImplementation(() => ({ credential: jest.fn(() => ({})) })),
}));
jest.mock('firebase/firestore', () => ({
  initializeFirestore: jest.fn(() => ({})),
  memoryLocalCache: jest.fn((opts?: unknown) => ({ __cache: 'memory', opts })),
  memoryEagerGarbageCollector: jest.fn(() => ({ __gc: 'eager' })),
  // Deliberately still mocked although firebaseService.ts no longer imports it:
  // this is the tripwire for re-adding a cache React Native cannot provide.
  persistentLocalCache: jest.fn(() => ({})),
  doc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  deleteDoc: jest.fn(),
  updateDoc: jest.fn(),
  collection: jest.fn(),
  serverTimestamp: jest.fn(),
  increment: jest.fn(),
  runTransaction: jest.fn(),
}));
jest.mock('firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(),
}));

import {
  auth,
  deserializeFirestoreGame,
  fetchSavedPlayersFromFirestore,
  incrementProfileStats,
  reverseProfileStats,
  saveGameToFirestore,
  sendVerificationEmail,
  signInWithGoogleCredential,
  signInWithAppleCredential,
  linkGoogleCredential,
  linkAppleCredential,
} from '@/services/firebaseService';
import {
  getDoc,
  setDoc,
  runTransaction,
  increment,
  updateDoc,
  initializeFirestore,
  persistentLocalCache,
  memoryLocalCache,
  memoryEagerGarbageCollector,
} from 'firebase/firestore';
import { sendEmailVerification, signInWithCredential, linkWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { Game } from '@/types/game';

describe('Firestore cache configuration', () => {
  // firebaseService.ts used to pass persistentLocalCache(). React Native has no
  // indexedDB global and this app ships no polyfill, so isIndexedDBAvailable()
  // is false, IndexedDbPersistence's constructor throws UNIMPLEMENTED, and the SDK
  // quietly swaps in a memory cache while logging 'Error using user provided cache.
  // Falling back to memory cache' — a warning the console.warn filter in
  // firebaseService.ts does not suppress. These pin the fallback as the stated config.
  it('never asks for the persistent cache', () => {
    expect(persistentLocalCache).not.toHaveBeenCalled();
  });

  it('asks for the in-memory cache with the EAGER collector', () => {
    // Not a bare memoryLocalCache(): its default is the LRU collector (40MB cap),
    // which is a different provider (LruGcMemoryOfflineComponentProvider +
    // MemoryLruDelegate + LruScheduler) than the fallback this replaces
    // (MemoryOfflineComponentProvider + MemoryEagerDelegate + no scheduler).
    expect(memoryEagerGarbageCollector).toHaveBeenCalled();
    expect(memoryLocalCache).toHaveBeenCalledWith({
      garbageCollector: (memoryEagerGarbageCollector as jest.Mock).mock.results[0].value,
    });
  });

  it('hands that cache to initializeFirestore', () => {
    expect(initializeFirestore).toHaveBeenCalledWith(expect.anything(), {
      localCache: (memoryLocalCache as jest.Mock).mock.results[0].value,
    });
  });
});

describe('deserializeFirestoreGame', () => {
  const baseDoc = {
    id: 'g1',
    name: 'Friday Night',
    date: new Date('2026-07-01T20:00:00Z'),
    status: 'active',
    players: [{ id: 'p1', name: 'Alice' }],
    transactions: [
      { id: 't1', playerId: 'p1', type: 'buyin', amount: 100, timestamp: new Date('2026-07-01T20:05:00Z') },
    ],
    createdAt: new Date('2026-07-01T20:00:00Z'),
    syncedAt: new Date('2026-07-02T01:00:00Z'),
  };

  it('preserves cashUnit so a synced game does not reset to the default', () => {
    const game = deserializeFirestoreGame({ ...baseDoc, cashUnit: 20 });
    expect(game.cashUnit).toBe(20);
  });

  it('preserves cashUnit=0 (Exact)', () => {
    const game = deserializeFirestoreGame({ ...baseDoc, cashUnit: 0 });
    expect(game.cashUnit).toBe(0);
  });

  it('preserves currency', () => {
    const game = deserializeFirestoreGame({ ...baseDoc, currency: 'JPY' });
    expect(game.currency).toBe('JPY');
  });

  it('leaves cashUnit/currency undefined when absent in the document', () => {
    const game = deserializeFirestoreGame(baseDoc);
    expect(game.cashUnit).toBeUndefined();
    expect(game.currency).toBeUndefined();
  });

  it('synthesizes a player preferredPayment into methods so it does not reset after a sync', () => {
    // Post-2.0.3, preferredPayment is derive-on-write only and never lives in memory —
    // see withSynthesizedMethods in utils/paymentMethods.ts. A legacy-only document still
    // round-trips through methods/defaultMethod, which is what every read site now uses.
    const game = deserializeFirestoreGame({
      ...baseDoc,
      players: [{ id: 'p1', name: 'Alice', preferredPayment: { method: 'venmo', handle: '@alice' } }],
    });
    expect(game.players[0].methods).toEqual({ venmo: '@alice' });
    expect(game.players[0].defaultMethod).toBe('venmo');
    // Player no longer has this field at all (Task 9); cast to check withSynthesizedMethods
    // actually strips it at runtime rather than relying on the type system alone.
    expect((game.players[0] as any).preferredPayment).toBeUndefined();
  });

  it('synthesizes a preferredPayment with no handle (e.g. cash) without inventing one', () => {
    const game = deserializeFirestoreGame({
      ...baseDoc,
      players: [{ id: 'p1', name: 'Alice', preferredPayment: { method: 'cash' } }],
    });
    expect(game.players[0].methods).toEqual({ cash: '' });
    expect(game.players[0].defaultMethod).toBe('cash');
  });

  it('leaves preferredPayment undefined when absent on the player', () => {
    const game = deserializeFirestoreGame(baseDoc);
    expect((game.players[0] as any).preferredPayment).toBeUndefined();
  });

  it('round-trips Player.savedPlayerId (must be in the deserialize whitelist)', () => {
    const game = deserializeFirestoreGame({
      id: 'g1',
      name: 'Game',
      date: new Date(),
      createdAt: new Date(),
      status: 'active',
      players: [{ id: 'p1', name: 'Mike', savedPlayerId: 'sp_123' }],
      transactions: [],
    });
    expect(game.players[0].savedPlayerId).toBe('sp_123');
  });

  it('round-trips statsCounted (must be in the deserialize whitelist)', () => {
    const game = deserializeFirestoreGame({ ...baseDoc, statsCounted: true });
    expect(game.statsCounted).toBe(true);
  });

  it('leaves statsCounted undefined when absent in the document', () => {
    const game = deserializeFirestoreGame(baseDoc);
    expect(game.statsCounted).toBeUndefined();
  });

  it('preserves imbalanceTolerance through deserialization', () => {
    const game = deserializeFirestoreGame({ ...baseDoc, imbalanceTolerance: 10 });
    expect(game.imbalanceTolerance).toBe(10);
  });

  it('preserves an imbalanceTolerance of 0 (strict) — no falsy coercion', () => {
    const game = deserializeFirestoreGame({ ...baseDoc, imbalanceTolerance: 0 });
    expect(game.imbalanceTolerance).toBe(0);
  });

  it('leaves imbalanceTolerance undefined when absent so the currency default applies', () => {
    const game = deserializeFirestoreGame(baseDoc);
    expect(game.imbalanceTolerance).toBeUndefined();
  });

  it('preserves defaultBuyIn through deserialization', () => {
    const game = deserializeFirestoreGame({ ...baseDoc, defaultBuyIn: 20 });
    expect(game.defaultBuyIn).toBe(20);
  });

  it('preserves a defaultBuyIn of 0 (off) — no falsy coercion', () => {
    const game = deserializeFirestoreGame({ ...baseDoc, defaultBuyIn: 0 });
    expect(game.defaultBuyIn).toBe(0);
  });

  it('leaves defaultBuyIn undefined when absent', () => {
    const game = deserializeFirestoreGame(baseDoc);
    expect(game.defaultBuyIn).toBeUndefined();
  });

  it('preserves methods and defaultMethod through the Firestore whitelist', () => {
    const game = deserializeFirestoreGame({
      ...baseDoc,
      players: [{ id: 'p1', name: 'Alice', methods: { venmo: 'a', zelle: 'b' }, defaultMethod: 'zelle' }],
    });
    expect(game.players[0].methods).toEqual({ venmo: 'a', zelle: 'b' });
    expect(game.players[0].defaultMethod).toBe('zelle');
  });

  it('synthesizes methods from a legacy-only Firestore player', () => {
    const game = deserializeFirestoreGame({
      ...baseDoc,
      players: [{ id: 'p1', name: 'Alice', preferredPayment: { method: 'venmo', handle: 'alice-h' } }],
    });
    expect(game.players[0].methods).toEqual({ venmo: 'alice-h' });
    expect(game.players[0].defaultMethod).toBe('venmo');
  });

  it('leaves both fields undefined when the player has no payment at all', () => {
    const game = deserializeFirestoreGame({ ...baseDoc, players: [{ id: 'p1', name: 'Alice' }] });
    expect(game.players[0].methods).toBeUndefined();
    expect(game.players[0].defaultMethod).toBeUndefined();
  });
});

// The ONLY path a derived preferredPayment takes to a shipped 2.0.2 device is Firestore —
// AsyncStorage is device-local. So this is the leg that actually delivers the dual-write
// safety net; unlike the local round-trip, nothing else pins it.
describe('saveGameToFirestore — outbound legacy dual-write', () => {
  beforeEach(() => {
    (setDoc as jest.Mock).mockClear();
    (setDoc as jest.Mock).mockResolvedValue(undefined);
  });

  function makeGame(players: any[]): Game {
    return {
      id: 'g1',
      name: 'G',
      date: new Date('2026-07-01T00:00:00Z'),
      status: 'active',
      players,
      transactions: [],
      createdAt: new Date('2026-07-01T00:00:00Z'),
    } as Game;
  }

  it('derives preferredPayment onto the Firestore write payload', async () => {
    await saveGameToFirestore('uid1', makeGame([
      { id: 'p1', name: 'Alice', methods: { venmo: 'v', zelle: 'z' }, defaultMethod: 'zelle' },
    ]));
    expect(setDoc as jest.Mock).toHaveBeenCalledTimes(1);
    const payload = (setDoc as jest.Mock).mock.calls[0][1];
    expect(payload.players[0].preferredPayment).toEqual({ method: 'zelle', handle: 'z' });
  });

  it('derives a label-only preferredPayment with no handle key present (Firestore rejects undefined)', async () => {
    await saveGameToFirestore('uid1', makeGame([
      { id: 'p1', name: 'Alice', methods: { venmo: '' }, defaultMethod: 'venmo' },
    ]));
    const payload = (setDoc as jest.Mock).mock.calls[0][1];
    expect(payload.players[0].preferredPayment).toEqual({ method: 'venmo' });
    expect('handle' in payload.players[0].preferredPayment).toBe(false);
  });
});

describe('fetchSavedPlayersFromFirestore', () => {
  it('returns players + tombstones when the document exists', async () => {
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ players: [{ name: 'Alice', updatedAt: 5 }], tombstones: { sp_bob: 9 } }),
    });
    expect(await fetchSavedPlayersFromFirestore('userA')).toEqual({
      players: [{ name: 'Alice', updatedAt: 5 }],
      tombstones: { sp_bob: 9 },
    });
  });

  it('returns empty players + {} tombstones when the document is missing', async () => {
    (getDoc as jest.Mock).mockResolvedValueOnce({ exists: () => false });
    expect(await fetchSavedPlayersFromFirestore('userA')).toEqual({ players: [], tombstones: {} });
  });

  it('defaults players to [] and tombstones to {} when absent or malformed', async () => {
    (getDoc as jest.Mock).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ tombstones: [1, 2] }), // players missing; tombstones not a map
    });
    expect(await fetchSavedPlayersFromFirestore('userA')).toEqual({ players: [], tombstones: {} });
  });
});

// Regression guard for the OAuth doc-creation defect: the modular Firebase SDK's
// UserCredential has no `additionalUserInfo` property, so gating createUserDocument
// on `(result as any).additionalUserInfo?.isNewUser` meant Apple/Google accounts
// never got a /users/{uid} doc — which broke trials, currency, and stat tracking.
describe('OAuth sign-in creates the user document unconditionally', () => {
  beforeEach(() => {
    (setDoc as jest.Mock).mockClear();
    (setDoc as jest.Mock).mockResolvedValue(undefined);
    // Modular UserCredential carries NO additionalUserInfo — mirror that here.
    (signInWithCredential as jest.Mock).mockResolvedValue({
      user: { uid: 'oauthUid', email: 'user@example.com', displayName: null, photoURL: null },
    });
    // Doc does not exist yet, so createUserDocument proceeds to write it.
    (getDoc as jest.Mock).mockResolvedValue({ exists: () => false });
  });

  it('Google sign-in writes the user doc even though isNewUser is unavailable', async () => {
    await signInWithGoogleCredential('id-token');
    expect(setDoc as jest.Mock).toHaveBeenCalledTimes(1);
    expect((setDoc as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({ tier: 'free', totalGamesPlayed: 0, biggestPot: 0 }),
    );
  });

  it('Apple sign-in writes the user doc even though isNewUser is unavailable', async () => {
    await signInWithAppleCredential('identity-token');
    expect(setDoc as jest.Mock).toHaveBeenCalledTimes(1);
    expect((setDoc as jest.Mock).mock.calls[0][1]).toEqual(
      expect.objectContaining({ tier: 'free', totalGamesPlayed: 0, biggestPot: 0 }),
    );
  });

  it('does not overwrite an existing doc (createUserDocument is a no-op)', async () => {
    (getDoc as jest.Mock).mockResolvedValue({ exists: () => true });
    await signInWithGoogleCredential('id-token');
    expect(setDoc as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('incrementProfileStats — biggestPot', () => {
  beforeEach(() => {
    (increment as jest.Mock).mockImplementation((n: number) => ({ __increment: n }));
    (updateDoc as jest.Mock).mockClear();
    (updateDoc as jest.Mock).mockResolvedValue(undefined);
  });

  // Counters are now written via a separate offline-durable `updateDoc` call
  // that runs before the biggestPot transaction — see incrementProfileStats.
  function runWith(existingBiggest: unknown, gamePot: number) {
    const update = jest.fn();
    (runTransaction as jest.Mock).mockImplementationOnce(async (_db, cb) => {
      await cb({
        get: async () => ({
          exists: () => true,
          data: () => (existingBiggest === undefined ? {} : { biggestPot: existingBiggest }),
        }),
        update,
      });
    });
    return { update, gamePot };
  }

  it('raises biggestPot when the new pot is larger', async () => {
    const { update } = runWith(500, 1200);
    await incrementProfileStats('u1', { gamesPlayed: 1, moneyTracked: 200, playersHosted: 4, gamePot: 1200 });
    expect(update.mock.calls[0][1]).toEqual(expect.objectContaining({ biggestPot: 1200 }));
  });

  it('holds biggestPot when the new pot is smaller', async () => {
    const { update } = runWith(1500, 300);
    await incrementProfileStats('u1', { gamesPlayed: 1, moneyTracked: 300, playersHosted: 3, gamePot: 300 });
    expect(update.mock.calls[0][1]).toEqual(expect.objectContaining({ biggestPot: 1500 }));
  });

  it('initializes biggestPot from 0 when the field is absent', async () => {
    const { update } = runWith(undefined, 800);
    await incrementProfileStats('u1', { gamesPlayed: 1, moneyTracked: 800, playersHosted: 5, gamePot: 800 });
    expect(update.mock.calls[0][1]).toEqual(expect.objectContaining({ biggestPot: 800 }));
  });

  it('still increments the three counters via updateDoc', async () => {
    runWith(0, 100);
    await incrementProfileStats('u1', { gamesPlayed: 1, moneyTracked: 100, playersHosted: 2, gamePot: 100 });
    expect((updateDoc as jest.Mock).mock.calls[0][1]).toEqual(expect.objectContaining({
      totalGamesPlayed: { __increment: 1 },
      totalMoneyTracked: { __increment: 100 },
      totalPlayersHosted: { __increment: 2 },
    }));
  });

  it('preserves the three counters when the biggestPot transaction rejects offline (durability regression guard)', async () => {
    (runTransaction as jest.Mock).mockRejectedValueOnce(new Error('offline'));

    await expect(
      incrementProfileStats('u1', { gamesPlayed: 1, moneyTracked: 150, playersHosted: 3, gamePot: 900 }),
    ).rejects.toThrow('offline');

    // The counters must have been written via updateDoc BEFORE the
    // transaction rejected — that's the whole point of the split.
    expect((updateDoc as jest.Mock).mock.calls[0][1]).toEqual(expect.objectContaining({
      totalGamesPlayed: { __increment: 1 },
      totalMoneyTracked: { __increment: 150 },
      totalPlayersHosted: { __increment: 3 },
    }));
  });
});

describe('reverseProfileStats', () => {
  beforeEach(() => {
    (increment as jest.Mock).mockImplementation((n: number) => ({ __increment: n }));
    (updateDoc as jest.Mock).mockClear();
    (updateDoc as jest.Mock).mockResolvedValue(undefined);
    (runTransaction as jest.Mock).mockClear();
  });

  it('negates the three counters in a single offline-durable updateDoc write', async () => {
    await reverseProfileStats('u1', { gamesPlayed: 1, moneyTracked: 250, playersHosted: 5 });
    expect(updateDoc).toHaveBeenCalledTimes(1);
    expect((updateDoc as jest.Mock).mock.calls[0][1]).toEqual({
      totalGamesPlayed: { __increment: -1 },
      totalMoneyTracked: { __increment: -250 },
      totalPlayersHosted: { __increment: -5 },
    });
  });

  it('never touches biggestPot — no transaction runs on reversal', async () => {
    await reverseProfileStats('u1', { gamesPlayed: 1, moneyTracked: 100, playersHosted: 3 });
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

describe('sendVerificationEmail', () => {
  afterEach(() => {
    (auth as any).currentUser = null;
  });

  it('sends a verification email to the signed-in user', async () => {
    (auth as any).currentUser = { uid: 'u1' };
    await sendVerificationEmail();
    expect(sendEmailVerification).toHaveBeenCalledWith({ uid: 'u1' });
  });

  it('throws when there is no signed-in user', async () => {
    (auth as any).currentUser = null;
    await expect(sendVerificationEmail()).rejects.toThrow('No authenticated user');
  });
});

describe('account linking', () => {
  afterEach(() => {
    (auth as any).currentUser = null;
    jest.clearAllMocks();
  });

  it('linkGoogleCredential links the google credential to the current user', async () => {
    (auth as any).currentUser = { uid: 'u1' };
    (GoogleAuthProvider.credential as jest.Mock).mockReturnValueOnce({ __g: true });
    (linkWithCredential as jest.Mock).mockResolvedValueOnce({ user: { uid: 'u1', providerData: [{ providerId: 'google.com' }] } });

    const user = await linkGoogleCredential('id-token');

    expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('id-token');
    expect(linkWithCredential).toHaveBeenCalledWith({ uid: 'u1' }, { __g: true });
    expect(user).toEqual({ uid: 'u1', providerData: [{ providerId: 'google.com' }] });
  });

  it('linkGoogleCredential throws when there is no signed-in user', async () => {
    (auth as any).currentUser = null;
    await expect(linkGoogleCredential('id-token')).rejects.toThrow('No authenticated user');
  });

  it('linkAppleCredential links the apple credential to the current user', async () => {
    (auth as any).currentUser = { uid: 'u1' };
    (linkWithCredential as jest.Mock).mockResolvedValueOnce({ user: { uid: 'u1' } });

    const user = await linkAppleCredential('identity-token');

    expect(linkWithCredential).toHaveBeenCalled();
    expect(user).toEqual({ uid: 'u1' });
  });

  it('linkAppleCredential throws when there is no signed-in user', async () => {
    (auth as any).currentUser = null;
    await expect(linkAppleCredential('identity-token')).rejects.toThrow('No authenticated user');
  });

  it('propagates auth/credential-already-in-use so the UI can map it', async () => {
    (auth as any).currentUser = { uid: 'u1' };
    (linkWithCredential as jest.Mock).mockRejectedValueOnce({ code: 'auth/credential-already-in-use' });
    await expect(linkGoogleCredential('id-token')).rejects.toMatchObject({ code: 'auth/credential-already-in-use' });
  });
});

/**
 * bug-420. The remote half of the game path. applyPaymentInvariant now keeps every method the
 * user added, handle or not, so a '' handle has to survive BOTH directions here — otherwise a
 * blank Cash row saves locally, is stripped on the Firestore write, and comes back missing
 * after the next remote merge: Heagen's exact symptom, one app reload later.
 */
describe('game payment fidelity for handle-less methods (bug-420)', () => {
  beforeEach(() => {
    (setDoc as jest.Mock).mockClear();
    (setDoc as jest.Mock).mockResolvedValue(undefined);
  });

  it('writes an empty-handle method rather than stripping it (stripUndefined keeps "")', async () => {
    await saveGameToFirestore('uid1', {
      id: 'g1', name: 'G', date: new Date('2026-07-01T00:00:00Z'), status: 'active',
      players: [{ id: 'p1', name: 'Alice', methods: { cash: '', venmo: 'v' }, defaultMethod: 'venmo' }],
      transactions: [], createdAt: new Date('2026-07-01T00:00:00Z'),
    } as any);
    const payload = (setDoc as jest.Mock).mock.calls[0][1];
    expect(payload.players[0].methods).toEqual({ cash: '', venmo: 'v' });
    // The derived legacy field still tracks the default only, so a 2.0.2 reader is unchanged.
    expect(payload.players[0].preferredPayment).toEqual({ method: 'venmo', handle: 'v' });
  });

  it('reads an empty-handle method back through the deserialize whitelist', () => {
    const game = deserializeFirestoreGame({
      id: 'g1', name: 'G', date: new Date('2026-07-01T00:00:00Z'), status: 'active',
      players: [{ id: 'p1', name: 'Alice', methods: { cash: '', venmo: 'v' }, defaultMethod: 'venmo' }],
      transactions: [], createdAt: new Date('2026-07-01T00:00:00Z'),
    });
    expect(game.players[0].methods).toEqual({ cash: '', venmo: 'v' });
    expect(game.players[0].defaultMethod).toBe('venmo');
  });

  it('does not let a stale legacy field overwrite a kept blank method', () => {
    // withSynthesizedMethods must return `rest` untouched whenever methods is present, even
    // when the map holds only blanks alongside a filled entry.
    const game = deserializeFirestoreGame({
      id: 'g1', name: 'G', date: new Date('2026-07-01T00:00:00Z'), status: 'active',
      players: [{
        id: 'p1', name: 'Alice',
        methods: { cash: '', venmo: 'v' }, defaultMethod: 'venmo',
        preferredPayment: { method: 'zelle', handle: 'stale@x.com' },
      }],
      transactions: [], createdAt: new Date('2026-07-01T00:00:00Z'),
    });
    expect(game.players[0].methods).toEqual({ cash: '', venmo: 'v' });
    expect((game.players[0] as any).preferredPayment).toBeUndefined();
  });
});
