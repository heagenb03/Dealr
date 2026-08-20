/**
 * Firestore rules tests for /sharedGames — the first cross-user read path in
 * this codebase.
 *
 * Run with `npm test` in this directory. Requires Java (17 confirmed on this
 * machine) and firebase-tools. NOT part of the frontend jest suite: its
 * 788/53 count must stay unambiguous.
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, getDocs, collection } = require('firebase/firestore');

let testEnv;

const OWNER = 'owner-uid';
const OTHER = 'other-uid';
const SHARE_ID = 'aB3dEfGh1JkLmN0pQrSt'; // 20 chars, [A-Za-z0-9] — a realistic Firestore auto-ID

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function snapshot(overrides = {}) {
  return {
    gameName: 'Friday Night',
    date: new Date(),
    currency: 'USD',
    settlementMode: 'optimal',
    totalPot: 200,
    balances: [
      { playerId: 'p1', playerName: 'Ada', totalBuyins: 100, totalCashouts: 140, netBalance: 40 },
    ],
    settlements: [{ from: 'Bob', to: 'Ada', amount: 40 }],
    payments: { Ada: { method: 'venmo', handle: 'ada-l' } },
    ...overrides,
  };
}

function sharedGame(overrides = {}) {
  return {
    ownerUid: OWNER,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * DAY),
    schema: 1,
    snapshot: snapshot(),
    ...overrides,
  };
}

/** Seed a document past the rules, so read/update/delete cases start from a real doc. */
async function seed(data = sharedGame()) {
  await testEnv.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'sharedGames', SHARE_ID), data);
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'cashcage-app',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('read', () => {
  it('lets any signed-in user GET a shared game', async () => {
    await seed();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertSucceeds(getDoc(doc(db, 'sharedGames', SHARE_ID)));
  });

  it('DENIES GET to an unauthenticated caller', async () => {
    // request.auth != null is defense in depth on top of the ~119-bit id,
    // not a replacement for it: no reader in this system is ever
    // unauthenticated at read time (Task 10's auth gate sends a signed-out
    // visitor to /(auth)/login before the shared route renders, and the
    // doormat page never touches Firestore) — see the rules comment on
    // `allow get`.
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'sharedGames', SHARE_ID)));
  });

  it('DENIES LIST even to the owner', async () => {
    // The single most important line in the feature. Without it, one query
    // enumerates every shared game ever created, payment handles included.
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(getDocs(collection(db, 'sharedGames')));
  });

  it('DENIES LIST to an unauthenticated caller', async () => {
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, 'sharedGames')));
  });
});

describe('create', () => {
  it('lets a signed-in user create a doc they own', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame()));
  });

  it('denies create with someone else as ownerUid', async () => {
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame()));
  });

  it('denies create when unauthenticated', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame()));
  });

  it('denies more than 100 balances', async () => {
    const balances = Array.from({ length: 101 }, (_, i) => ({
      playerId: `p${i}`, playerName: `P${i}`, totalBuyins: 1, totalCashouts: 1, netBalance: 0,
    }));
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ balances }) })),
    );
  });

  it('denies more than 500 settlements', async () => {
    const settlements = Array.from({ length: 501 }, () => ({ from: 'A', to: 'B', amount: 1 }));
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ settlements }) })),
    );
  });

  it('denies a gameName over 100 characters', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ gameName: 'x'.repeat(101) }) })),
    );
  });

  it('denies an expiresAt beyond the 31-day bound', async () => {
    // Stops a client writing a snapshot that outlives the TTL window.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ expiresAt: new Date(Date.now() + 40 * DAY) })),
    );
  });

  it('allows an expiresAt just inside the bound', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ expiresAt: new Date(Date.now() + 30 * DAY) })),
    );
  });

  it('denies a doc missing a required field (snapshot)', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const { snapshot: _drop, ...rest } = sharedGame();
    await assertFails(setDoc(doc(db, 'sharedGames', SHARE_ID), rest));
  });

  it('denies a doc missing a required field (expiresAt)', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const { expiresAt: _drop, ...rest } = sharedGame();
    await assertFails(setDoc(doc(db, 'sharedGames', SHARE_ID), rest));
  });
});

describe('create — document ID format (Ruling 2)', () => {
  // The URL IS the credential at ~119 bits. An unconstrained document id would
  // let a client create (and an attacker then enumerate) a short, guessable
  // id like /sharedGames/abc, voiding the entire security model.
  it('denies create at a too-short id', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(setDoc(doc(db, 'sharedGames', 'tooShort123'), sharedGame()));
  });

  it('denies create at a 20-char id containing a disallowed character', async () => {
    // 20 characters, but with a dash — same length as a valid id, wrong alphabet.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(setDoc(doc(db, 'sharedGames', 'aB3dEfGh1-kLmN0pQrSt'), sharedGame()));
  });

  it('allows create at a valid 20-char [A-Za-z0-9] id', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame()));
  });
});

describe('update — owner only, and never a viewer', () => {
  it('lets the OWNER refresh their own snapshot', async () => {
    // Owner update is deliberately permitted: a host who reopens and re-completes
    // a game must be able to fix a link already sitting in a group chat.
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ totalPot: 999 }) })),
    );
  });

  it('DENIES update by any other signed-in user', async () => {
    // The frozen-snapshot invariant: exactly one writer, never a viewer.
    await seed();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ totalPot: 999 }) })),
    );
  });

  it('DENIES update by an unauthenticated caller', async () => {
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ totalPot: 999 }) })),
    );
  });

  it('DENIES an update that reassigns ownerUid', async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ ownerUid: OTHER })),
    );
  });

  it('denies an owner update that blows past the size caps', async () => {
    // Strengthened over the spec: without this an owner can refresh a 1-row link
    // into a 10,000-row document, bypassing the storage guard entirely.
    await seed();
    const balances = Array.from({ length: 101 }, (_, i) => ({
      playerId: `p${i}`, playerName: `P${i}`, totalBuyins: 1, totalCashouts: 1, netBalance: 0,
    }));
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ balances }) })),
    );
  });

  it('denies an owner update with an expiresAt beyond the 31-day bound', async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ expiresAt: new Date(Date.now() + 40 * DAY) })),
    );
  });
});

describe('delete', () => {
  it('lets the owner delete', async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(deleteDoc(doc(db, 'sharedGames', SHARE_ID)));
  });

  it('denies delete by another user', async () => {
    await seed();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(deleteDoc(doc(db, 'sharedGames', SHARE_ID)));
  });

  it('denies delete when unauthenticated', async () => {
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(deleteDoc(doc(db, 'sharedGames', SHARE_ID)));
  });
});
