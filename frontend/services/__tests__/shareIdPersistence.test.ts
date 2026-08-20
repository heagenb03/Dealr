// Firebase SDK is initialized at module scope in firebaseService, so every
// firebase entry point must be mocked before the module is imported. Mirrors
// the preamble in firebaseService.test.ts — deserializeFirestoreGame is the
// real function under test, only the SDK underneath it is faked.
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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { deserializeFirestoreGame } from '@/services/firebaseService';
import { StorageService } from '@/services/storageService';
import { Game } from '@/types/game';
import { isShareId } from '@/utils/shareLink';

const SHARE_ID = 'aB3dEfGh1JkLmN0pQrSt';

const baseGame: Game = {
  id: 'g1',
  name: 'Friday Night',
  date: new Date('2026-08-19T00:00:00.000Z'),
  status: 'completed',
  createdAt: new Date('2026-08-19T00:00:00.000Z'),
  players: [{ id: 'p1', name: 'Ada' }],
  transactions: [],
  shareId: SHARE_ID,
};

describe('shareId — Firestore round-trip', () => {
  it('survives deserializeFirestoreGame', () => {
    // deserializeFirestoreGame is a WHITELIST. Without an explicit line for
    // shareId, a re-share after any Firestore read mints a SECOND link and the
    // one already sitting in a group chat goes stale forever.
    const doc = {
      id: 'g1',
      name: 'Friday Night',
      date: new Date('2026-08-19T00:00:00.000Z'),
      status: 'completed',
      createdAt: new Date('2026-08-19T00:00:00.000Z'),
      players: [{ id: 'p1', name: 'Ada' }],
      transactions: [],
      shareId: SHARE_ID,
    };
    const game = deserializeFirestoreGame(doc);
    expect(game.shareId).toBe(SHARE_ID);
    expect(isShareId(game.shareId!)).toBe(true);
  });

  it('leaves shareId undefined for a game that was never shared', () => {
    const doc = {
      id: 'g1',
      name: 'Friday Night',
      date: new Date(),
      status: 'completed',
      createdAt: new Date(),
      players: [],
      transactions: [],
    };
    expect(deserializeFirestoreGame(doc).shareId).toBeUndefined();
  });

  it('preserves shareAcked through deserializeFirestoreGame', () => {
    // Same whitelist hazard as shareId above. Dropped here, a host who shares
    // from device A and then shares again from device B sends TEXT ONLY,
    // because device B reads shareAcked back as undefined.
    const doc = {
      id: 'g1',
      name: 'Friday Night',
      date: new Date('2026-08-19T00:00:00.000Z'),
      status: 'completed',
      createdAt: new Date('2026-08-19T00:00:00.000Z'),
      players: [{ id: 'p1', name: 'Ada' }],
      transactions: [],
      shareId: SHARE_ID,
      shareAcked: true,
    };
    expect(deserializeFirestoreGame(doc).shareAcked).toBe(true);
  });

  it('preserves an explicit false shareAcked', () => {
    // A first share that timed out stores an explicit false. Reading that back
    // as undefined is harmless today (both are falsy) but would break the
    // moment anything distinguishes "never shared" from "shared, never acked".
    const doc = {
      id: 'g1',
      name: 'Friday Night',
      date: new Date('2026-08-19T00:00:00.000Z'),
      status: 'completed',
      createdAt: new Date('2026-08-19T00:00:00.000Z'),
      players: [{ id: 'p1', name: 'Ada' }],
      transactions: [],
      shareId: SHARE_ID,
      shareAcked: false,
    };
    expect(deserializeFirestoreGame(doc).shareAcked).toBe(false);
  });
});

describe('shareId — AsyncStorage round-trip', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('survives saveGames -> loadGames', async () => {
    await StorageService.saveGames([baseGame]);
    const loaded = await StorageService.loadGames();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].shareId).toBe(SHARE_ID);
  });

  it('leaves shareId undefined for a game that was never shared', async () => {
    const { shareId, ...unshared } = baseGame;
    await StorageService.saveGames([unshared as Game]);
    const loaded = await StorageService.loadGames();
    expect(loaded[0].shareId).toBeUndefined();
  });

  it('survives saveGames -> loadGames with shareAcked set', async () => {
    // No storageService change is expected: loadGames spreads unknown fields by
    // deliberate design. This test is the guard that a future refactor to a
    // whitelist does not silently drop the field.
    await StorageService.saveGames([{ ...baseGame, shareAcked: true }]);
    const loaded = await StorageService.loadGames();
    expect(loaded[0].shareAcked).toBe(true);
  });
});
