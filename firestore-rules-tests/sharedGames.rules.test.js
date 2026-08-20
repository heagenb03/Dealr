/**
 * Firestore rules tests for /sharedGames — the first cross-user read path in
 * this codebase.
 *
 * Run with `npm test` in this directory. Requires Java 21+ (firebase-tools
 * 15.5.1 hard-rejects anything older) and firebase-tools. NOT part of the
 * frontend jest suite: its 863/57 count must stay unambiguous.
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

  it('DENIES GET on an expired document, even to the owner (Fix 2)', async () => {
    // Recipients are told links last 30 days. Without this, a doc with a
    // past expiresAt stays readable until the TTL sweeper happens to run —
    // verified against a live emulator: a doc expired 365 days in the past
    // was still readable.
    await seed(sharedGame({ expiresAt: new Date(Date.now() - 365 * DAY) }));
    const ownerDb = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(getDoc(doc(ownerDb, 'sharedGames', SHARE_ID)));
    const otherDb = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(getDoc(doc(otherDb, 'sharedGames', SHARE_ID)));
  });

  it('DENIES an authenticated GET on a nonexistent shareId (Round 2 Fix B — pinned, not changed)', async () => {
    // Side effect of the Fix-2 expiry gate, not a new design choice: on a
    // nonexistent document, `resource` is null, so
    // `resource.data.expiresAt` dereferences a null resource and errors,
    // which fails closed to permission-denied. Before Fix 2, the same GET
    // succeeded and returned exists() === false. This test pins that
    // changed contract so the next person editing `allow get` sees the
    // consequence instead of rediscovering it. Not a security hole (fails
    // closed) — deliberately not "fixed": mapping this to a "this link has
    // expired / never existed" UI state is Task 7's job, not the rules'.
    // No doc is seeded for this shareId.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(getDoc(doc(db, 'sharedGames', SHARE_ID)));
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

  it('denies a doc missing a required field (schema) — Fix 4', async () => {
    // Unlike snapshot/expiresAt above, `schema` is never dereferenced
    // anywhere else in the rule, so this is the ONE case that actually
    // discriminates hasAll() rather than passing via a dereference error on
    // some other clause. See the mutation test in the report.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const { schema: _drop, ...rest } = sharedGame();
    await assertFails(setDoc(doc(db, 'sharedGames', SHARE_ID), rest));
  });

  it('denies create with an arbitrary extra top-level field (Fix 1 — hasOnly)', async () => {
    // Verified against a live emulator: hasAll alone checks presence, not
    // exclusivity, so a payload with all required fields PLUS an extra one
    // (in the real attack, ~900 KB of it) previously succeeded outright.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), { ...sharedGame(), hostilePayload: 'x'.repeat(1000) }),
    );
  });

  it('denies create with an arbitrary extra key INSIDE snapshot (Round 2 Fix A — the twin hole)', async () => {
    // Verified against a live emulator: the top-level hasOnly() (Fix 1
    // above) does not reach one level down. A ~900 KB key inside snapshot
    // (e.g. snapshot.junk) previously succeeded, because nothing guarded
    // snapshot's OWN key set — only its balances/settlements/gameName
    // fields were individually checked.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ junk: 'x'.repeat(1000) }) })),
    );
  });

  it('allows the optional bankerName/bankerPlayerId snapshot fields (subset, not exact match)', async () => {
    // hasOnly() permits a SUBSET of the listed keys, so the resolved-banker
    // shape from sharedGameSnapshot.ts (bankerName/bankerPlayerId present
    // only in banker mode) must still be writable. This guards against a
    // future edit accidentally swapping hasOnly's semantics or key list.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, 'sharedGames', SHARE_ID),
        sharedGame({
          snapshot: snapshot({ settlementMode: 'banker', bankerName: 'Ada', bankerPlayerId: 'p1' }),
        }),
      ),
    );
  });

  it('denies create when snapshot.balances is a string, not a list (Fix 1 — type guard)', async () => {
    // Verified against a live emulator: size() works on strings too, so
    // 'abc'.size() === 3 <= 100 silently passed a malformed snapshot.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ balances: 'abc' }) })),
    );
  });

  it('denies create when snapshot.settlements is a string, not a list (Fix 1 — type guard)', async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ settlements: 'de' }) })),
    );
  });

  it('denies create when snapshot.gameName is not a string (a list) (Fix 1 — type guard)', async () => {
    // A list also has .size() (3 <= 100 here), so this specifically needs
    // the `is string` guard, not just a size cap, to be caught.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ gameName: ['a', 'b', 'c'] }) })),
    );
  });

  it('denies create with an expiresAt already in the past (Fix 2 — born expired)', async () => {
    // Verified against a live emulator: a doc with expiresAt 365 days in the
    // past was accepted on create.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ expiresAt: new Date(Date.now() - 365 * DAY) })),
    );
  });

  it('denies an expiresAt just over the 31-day bound (31d + 1h) (Fix 4 — tight boundary)', async () => {
    // The pre-existing "beyond the 31-day bound" test used 40 days, which is
    // loose enough that any accidental bound between 31 and 39 days would
    // still pass it unchanged. This pins the actual cutoff at 31 days.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ expiresAt: new Date(Date.now() + 31 * DAY + HOUR) })),
    );
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

  it('denies an owner update at just over the 31-day bound (31d + 1h) (Fix 4 — tight boundary)', async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ expiresAt: new Date(Date.now() + 31 * DAY + HOUR) })),
    );
  });

  it('DENIES an owner update that drops schema (Fix 3 — hasAll on update)', async () => {
    // Verified against a live emulator: hasAll() was only checked on
    // create, so an owner could drop schema (or createdAt) via update with
    // nothing else in the rule noticing.
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const { schema: _drop, ...rest } = sharedGame({ snapshot: snapshot({ totalPot: 999 }) });
    await assertFails(setDoc(doc(db, 'sharedGames', SHARE_ID), rest));
  });

  it('DENIES an owner update that drops createdAt (Fix 3 — hasAll on update)', async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const { createdAt: _drop, ...rest } = sharedGame({ snapshot: snapshot({ totalPot: 999 }) });
    await assertFails(setDoc(doc(db, 'sharedGames', SHARE_ID), rest));
  });

  it('DENIES an owner update that drops expiresAt (Fix 3 — the bricking scenario)', async () => {
    // The scenario the coordinator flagged as load-bearing once Fix 2 lands:
    // if expiresAt could be dropped via update, the new expiry-gated `get`
    // rule would dereference an absent field on every future read and the
    // document would be permanently unreadable with no way to tell why.
    // NOTE (mutation-testing honesty): this specific case was already
    // fail-closed before hasRequiredKeys() was added to update, because
    // update's own expiresAt-upper-bound clause already dereferences
    // request.resource.data.expiresAt — an absent field errors there
    // independently of hasAll(). hasRequiredKeys() makes it robust against a
    // future refactor of that clause rather than being the only thing
    // stopping it today. Kept as a defense-in-depth regression test, not
    // presented as proof that hasAll() uniquely gates it — see the report.
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const { expiresAt: _drop, ...rest } = sharedGame({ snapshot: snapshot({ totalPot: 999 }) });
    await assertFails(setDoc(doc(db, 'sharedGames', SHARE_ID), rest));
  });

  it('DENIES an owner update that adds an arbitrary extra top-level field (Fix 3 — hasOnly on update)', async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), { ...sharedGame({ snapshot: snapshot({ totalPot: 999 }) }), hostilePayload: 'x'.repeat(1000) }),
    );
  });

  it('denies an owner update when snapshot.balances is a string, not a list (Fix 1 — validSnapshot shared by update)', async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, 'sharedGames', SHARE_ID), sharedGame({ snapshot: snapshot({ balances: 'abc' }) })),
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

  it('DENIES an authenticated delete on a nonexistent shareId', async () => {
    // Same mechanism as the nonexistent-GET case above: on a nonexistent
    // document `resource` is null, so `resource.data.ownerUid` dereferences a
    // null resource and errors, which fails closed to permission-denied — not
    // a silent no-op. This is what a double-delete or a TTL-swept target hits
    // in production, and what a timed-out first share's later delete hits too
    // (mintShareId persists a shareId before the write acks). No doc is
    // seeded for this shareId.
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(deleteDoc(doc(db, 'sharedGames', SHARE_ID)));
  });
});
