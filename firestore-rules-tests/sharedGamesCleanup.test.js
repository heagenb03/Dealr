/**
 * Emulator test for the account-deletion cleanup of /sharedGames.
 *
 * Runs against the COMPILED helper the Cloud Function actually calls
 * (functions/lib/sharedGamesCleanup.js, built by the pretest hook), not a
 * reimplementation — a test that re-derived the query would pass while the
 * shipped query was wrong.
 *
 * Uses firebase-admin, not @firebase/rules-unit-testing: the Admin SDK is what
 * the function uses, and it bypasses security rules, which is what lets this
 * path work despite `allow list: if false`. FIRESTORE_EMULATOR_HOST is set for
 * us by `firebase emulators:exec`.
 */
const admin = require('firebase-admin');
const { deleteSharedGamesForOwner } = require('../functions/lib/sharedGamesCleanup');

const OWNER = 'owner-uid';
const OTHER = 'other-uid';
const DAY = 24 * 60 * 60 * 1000;

let db;

function sharedGame(ownerUid) {
  return {
    ownerUid,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * DAY),
    schema: 1,
    snapshot: {
      gameName: 'Friday Night',
      totalPot: 200,
      balances: [],
      settlements: [],
      payments: {},
    },
  };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST unset — run via `npm test`, not bare jest.');
  }
  admin.initializeApp({ projectId: 'cashcage-app' });
  db = admin.firestore();

  // Warm the Admin SDK's first gRPC connection here, with headroom, instead
  // of letting it happen inside the first `beforeEach` below. `npm test`
  // runs this suite under `firebase emulators:exec`, which boots a FRESH
  // Firestore emulator on every invocation — there is no warm instance to
  // reuse across runs, so the first-handshake cold start is reproducible on
  // every cold run, not a one-off. Left unwarmed, that handshake can exceed
  // Jest's default 5000ms per-hook timeout and fail `beforeEach` before any
  // test body runs. This suite is a release gate (Task 7 Step 2 requires
  // "both suites PASS" before shipping), so an intermittent cold-start
  // failure here is worse than no gate at all — do not remove this.
  await db.collection('sharedGames').limit(1).get();
}, 15000);

afterAll(async () => {
  await admin.app().delete();
});

beforeEach(async () => {
  const all = await db.collection('sharedGames').get();
  await Promise.all(all.docs.map(d => d.ref.delete()));
}, 15000);

it("deletes the target user's share documents", async () => {
  await db.collection('sharedGames').doc('a').set(sharedGame(OWNER));
  await db.collection('sharedGames').doc('b').set(sharedGame(OWNER));

  const deleted = await deleteSharedGamesForOwner(db, OWNER);

  expect(deleted).toBe(2);
  const left = await db.collection('sharedGames').get();
  expect(left.size).toBe(0);
});

it("leaves ANOTHER user's share documents untouched", async () => {
  // THE ASSERTION THAT MATTERS. A helper that dropped the `where` clause would
  // pass the single-user test above and wipe the whole collection here.
  await db.collection('sharedGames').doc('mine').set(sharedGame(OWNER));
  await db.collection('sharedGames').doc('theirs').set(sharedGame(OTHER));

  const deleted = await deleteSharedGamesForOwner(db, OWNER);

  expect(deleted).toBe(1);
  const left = await db.collection('sharedGames').get();
  expect(left.docs.map(d => d.id)).toEqual(['theirs']);
});

it('is a no-op for a user who never shared', async () => {
  await db.collection('sharedGames').doc('theirs').set(sharedGame(OTHER));

  expect(await deleteSharedGamesForOwner(db, OWNER)).toBe(0);
  const left = await db.collection('sharedGames').get();
  expect(left.size).toBe(1);
});
