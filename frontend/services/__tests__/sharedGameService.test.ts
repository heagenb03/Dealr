/**
 * Firestore init throws (auth/invalid-api-key) under jest outside a configured
 * environment, and firebaseService.ts does that at import time. Stub it the
 * same way currencyFormatterMemo.test.tsx / gameDefaultsIsolation.test.tsx do,
 * since sharedGameService imports `db` from that module directly.
 */
jest.mock('@/services/firebaseService', () => ({ db: {} }));

// firebase/firestore itself is mocked so publishSharedGame/fetchSharedGame can
// be exercised without a real network. `mock`-prefixed names are required by
// babel-plugin-jest-hoist to be visible inside the jest.mock factory below.
const mockSetDoc = jest.fn((..._args: any[]) => Promise.resolve());
const mockDeleteDoc = jest.fn((..._args: any[]) => Promise.resolve());
const mockGetDoc = jest.fn();
const mockDoc = jest.fn((...args: any[]) => {
  if (args.length === 1) {
    // doc(collectionRef) — Firestore auto-ID form.
    return { id: 'abcdefghij0123456789ZZ'.slice(0, 20), __col: (args[0] as any).__col };
  }
  const [, path, id] = args;
  return { id, __col: path };
});
const mockCollection = jest.fn((..._args: any[]) => ({ __col: _args[1] }));

jest.mock('firebase/firestore', () => ({
  doc: (...args: any[]) => mockDoc(...args),
  collection: (...args: any[]) => mockCollection(...args),
  getDoc: (...args: any[]) => mockGetDoc(...args),
  setDoc: (...args: any[]) => mockSetDoc(...args),
  deleteDoc: (...args: any[]) => mockDeleteDoc(...args),
}));

import {
  SHARE_TTL_DAYS,
  SHARED_GAMES_COLLECTION,
  buildSharedGameDocument,
  shareExpiryFrom,
  deserializeSharedGame,
  mintShareId,
  publishSharedGame,
  fetchSharedGame,
  deleteSharedGame,
} from '@/services/sharedGameService';
import { buildSharedGameSnapshot, SHARED_GAME_SCHEMA } from '@/utils/sharedGameSnapshot';
import { DEFAULT_CURRENCY } from '@/constants/Currencies';
import { Game, PlayerBalance, Settlement } from '@/types/game';
import { isShareId } from '@/utils/shareLink';

const NOW = new Date('2026-08-19T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const balances: PlayerBalance[] = [
  { playerId: 'p1', playerName: 'Ada', totalBuyins: 100, totalCashouts: 140, netBalance: 40 },
];
const settlements: Settlement[] = [{ from: 'Bob', to: 'Ada', amount: 40 }];

const game: Game = {
  id: 'g1',
  name: 'Friday Night',
  date: NOW,
  status: 'completed',
  createdAt: NOW,
  currency: 'USD',
  players: [{ id: 'p1', name: 'Ada', preferredPayment: { method: 'venmo', handle: 'ada-l' } }],
  transactions: [],
};

const snapshot = buildSharedGameSnapshot({ game, balances, settlements, totalPot: 200 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('constants', () => {
  it('names the collection the rules match', () => {
    expect(SHARED_GAMES_COLLECTION).toBe('sharedGames');
    expect(SHARE_TTL_DAYS).toBe(30);
  });
});

describe('shareExpiryFrom', () => {
  it('returns the same instant buildSharedGameDocument stamps as expiresAt', () => {
    // This is the whole reason it is exported. buildShareUrl's ?e= param and
    // the document's expiresAt must be the same number: if they drift, the
    // doormat reports an expiry the rules do not enforce, or the reverse.
    expect(shareExpiryFrom(NOW)).toEqual(
      buildSharedGameDocument({ ownerUid: 'u1', snapshot, now: NOW }).expiresAt,
    );
  });

  it('is 30 days out from the injected now, not a live clock', () => {
    expect(shareExpiryFrom(NOW).getTime()).toBe(NOW.getTime() + SHARE_TTL_DAYS * DAY);
  });
});

describe('buildSharedGameDocument', () => {
  const built = () => buildSharedGameDocument({ ownerUid: 'u1', snapshot, now: NOW });

  it('builds exactly the five top-level keys the rules require (hasOnly)', () => {
    // Task 6's rules reject any extra top-level key outright. This pins the
    // exact key set so an added field (updatedAt, version, ...) fails loudly
    // here rather than being denied silently in production.
    expect(Object.keys(built()).sort()).toEqual(
      ['createdAt', 'expiresAt', 'ownerUid', 'schema', 'snapshot'].sort(),
    );
  });

  it('stamps ownerUid at DOCUMENT level, not inside the snapshot', () => {
    // The rules need it for update/delete, and keeping it out of `snapshot`
    // leaves the projection purely presentational.
    expect(built().ownerUid).toBe('u1');
    expect('ownerUid' in built().snapshot).toBe(false);
  });

  it('sets expiresAt exactly 30 days out from the injected now', () => {
    // Pinned to the real injected NOW, not derived from the result itself —
    // this fails if the implementation ignores `now` and uses a live clock.
    expect(built().expiresAt.getTime()).toBe(NOW.getTime() + 30 * DAY);
    expect(built().createdAt).toEqual(NOW);
  });

  it('sets an expiry interval of exactly 30 days, strictly inside the rules 31-day ceiling', () => {
    // REPLACES a tautological original: `expect(doc.expiresAt - NOW).toBeLessThanOrEqual(31 * DAY)`
    // compared the built value against the SAME NOW that produced it, so it
    // could not fail for any remotely sane implementation (even a hardcoded
    // "now + 1 day" would pass). This is the only guard on the 30-vs-31-day
    // clock-skew margin the whole TTL design rests on, so it must assert the
    // literal interval, not a loose inequality against its own input.
    const doc = built();
    const intervalMs = doc.expiresAt.getTime() - doc.createdAt.getTime();
    expect(intervalMs).toBe(SHARE_TTL_DAYS * DAY);
    // The actual invariant the design rests on: exactly one day of clock-skew
    // margin under the rules' 31-day ceiling. `toBeLessThan(31 * DAY)` alone
    // would be dead code here (it can't fail once the line above pins
    // intervalMs to 30 days) — this fails if the TTL ever moves to 31 days
    // (margin 0, breaks under any positive skew) or drops to 29.
    expect(31 * DAY - intervalMs).toBe(DAY);
  });

  it('stamps the schema version', () => {
    expect(built().schema).toBe(SHARED_GAME_SCHEMA);
  });

  it('carries the snapshot through untouched', () => {
    expect(built().snapshot).toEqual(snapshot);
  });

  it('writes no undefined values anywhere', () => {
    // Firestore rejects undefined outright, and a rejected write on the share
    // path surfaces to the user as a failed share.
    const seen: string[] = [];
    const walk = (value: any, at: string) => {
      if (value === undefined) seen.push(at);
      else if (value instanceof Date) return;
      else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${at}[${i}]`));
      else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, `${at}.${k}`);
      }
    };
    walk(built(), 'doc');
    expect(seen).toEqual([]);
  });
});

describe('deserializeSharedGame', () => {
  // Firestore hands back Timestamp objects, which expose toDate().
  const ts = (d: Date) => ({ toDate: () => d });

  const raw = {
    ownerUid: 'u1',
    createdAt: ts(NOW),
    expiresAt: ts(new Date(NOW.getTime() + 30 * DAY)),
    schema: 1,
    snapshot: { ...snapshot, date: ts(NOW) },
  };

  it('converts Timestamps back to Dates', () => {
    const doc = deserializeSharedGame(raw);
    expect(doc.createdAt).toEqual(NOW);
    expect(doc.expiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(doc.snapshot.date).toEqual(NOW);
  });

  it('round-trips the presentational fields', () => {
    const doc = deserializeSharedGame(raw);
    expect(doc.ownerUid).toBe('u1');
    expect(doc.schema).toBe(1);
    expect(doc.snapshot.gameName).toBe('Friday Night');
    expect(doc.snapshot.totalPot).toBe(200);
    expect(doc.snapshot.balances).toEqual(balances);
    expect(doc.snapshot.settlements).toEqual(settlements);
    expect(doc.snapshot.payments).toEqual({ Ada: { method: 'venmo', handle: 'ada-l' } });
  });

  it('defaults missing collections rather than throwing', () => {
    // A partial or future-shaped document must render, not crash the route.
    const doc = deserializeSharedGame({
      ownerUid: 'u1',
      createdAt: ts(NOW),
      expiresAt: ts(NOW),
      schema: 1,
      snapshot: { gameName: 'X', date: ts(NOW), currency: 'USD', settlementMode: 'optimal', totalPot: 0 },
    });
    expect(doc.snapshot.balances).toEqual([]);
    expect(doc.snapshot.settlements).toEqual([]);
    expect(doc.snapshot.payments).toEqual({});
  });

  it('accepts a plain Date where a Timestamp is expected', () => {
    // Firestore's local cache can hand back either. A naive `value.toDate()`
    // would throw on a plain Date, since Date has no toDate() method.
    const doc = deserializeSharedGame({ ...raw, createdAt: NOW });
    expect(doc.createdAt).toEqual(NOW);
  });

  // --- Ruling 2: scalars must be validated and defaulted, not just collections ---

  it('defaults a missing/non-numeric totalPot to 0, never NaN', () => {
    const doc = deserializeSharedGame({
      ...raw,
      snapshot: { ...raw.snapshot, totalPot: undefined },
    });
    expect(doc.snapshot.totalPot).toBe(0);
    expect(Number.isFinite(doc.snapshot.totalPot)).toBe(true);

    const docBad = deserializeSharedGame({
      ...raw,
      snapshot: { ...raw.snapshot, totalPot: 'not-a-number' as any },
    });
    expect(docBad.snapshot.totalPot).toBe(0);
  });

  it('defaults a missing/invalid snapshot.date to a real Date, never Invalid Date', () => {
    const doc = deserializeSharedGame({
      ...raw,
      snapshot: { ...raw.snapshot, date: undefined },
    });
    expect(doc.snapshot.date instanceof Date).toBe(true);
    expect(Number.isNaN(doc.snapshot.date.getTime())).toBe(false);
  });

  it('defaults a missing gameName to a non-empty string', () => {
    const doc = deserializeSharedGame({
      ...raw,
      snapshot: { ...raw.snapshot, gameName: undefined },
    });
    expect(typeof doc.snapshot.gameName).toBe('string');
    expect(doc.snapshot.gameName.length).toBeGreaterThan(0);
  });

  it('defaults an invalid settlementMode to optimal', () => {
    const doc = deserializeSharedGame({
      ...raw,
      snapshot: { ...raw.snapshot, settlementMode: 'bogus' as any },
    });
    expect(doc.snapshot.settlementMode).toBe('optimal');
  });

  it('treats an absent or non-numeric schema as OUTDATED, never as current', () => {
    // schema is compared against SHARED_GAME_SCHEMA to gate the "update your
    // app" prompt. `undefined > SHARED_GAME_SCHEMA` is `false`, which would
    // let a schema-less document silently render as if it were current.
    // Defaulting to 0 keeps it strictly below SHARED_GAME_SCHEMA, so it reads
    // unambiguously as "not current" under either direction of comparison.
    const docMissing = deserializeSharedGame({ ...raw, schema: undefined });
    expect(docMissing.schema).toBe(0);
    expect(docMissing.schema).not.toBe(SHARED_GAME_SCHEMA);
    expect(docMissing.schema < SHARED_GAME_SCHEMA).toBe(true);

    const docBad = deserializeSharedGame({ ...raw, schema: 'not-a-number' as any });
    expect(docBad.schema).toBe(0);
  });

  // --- Ruling 3: currency must resolve to a SUPPORTED code here, not downstream ---

  it('resolves a blank or unsupported currency to the default', () => {
    const docBlank = deserializeSharedGame({
      ...raw,
      snapshot: { ...raw.snapshot, currency: '' as any },
    });
    expect(docBlank.snapshot.currency).toBe(DEFAULT_CURRENCY);

    const docBad = deserializeSharedGame({
      ...raw,
      snapshot: { ...raw.snapshot, currency: 'ZZZ' as any },
    });
    expect(docBad.snapshot.currency).toBe(DEFAULT_CURRENCY);
  });

  it('keeps a supported currency untouched', () => {
    const doc = deserializeSharedGame({
      ...raw,
      snapshot: { ...raw.snapshot, currency: 'JPY' as any },
    });
    expect(doc.snapshot.currency).toBe('JPY');
  });
});

describe('mintShareId', () => {
  // The shared mockDoc's default 1-arg (auto-ID) branch returns a FIXED
  // string ('abcdefghij0123456789...') so publishSharedGame's tests below can
  // assert an exact id. That constant can't discriminate "returns the real
  // generated id" from "returns a hardcoded string" — a mintShareId that
  // ignored doc()/collection() entirely and returned a literal would still
  // pass against it. So for this test only, override doc() to return a
  // freshly-generated, differently-shaped id per call, and assert BOTH the
  // format (via Task 1's isShareId) and that two calls actually differ.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function randomAutoId(): string {
    let out = '';
    for (let i = 0; i < 20; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    return out;
  }

  it('returns a well-formed, unique Firestore auto-ID by delegating to doc(collection(db, ...))', () => {
    mockDoc
      .mockImplementationOnce((...args: any[]) => ({ id: randomAutoId(), __col: (args[0] as any).__col }))
      .mockImplementationOnce((...args: any[]) => ({ id: randomAutoId(), __col: (args[0] as any).__col }));

    const first = mintShareId();
    const second = mintShareId();

    expect(isShareId(first)).toBe(true);
    expect(isShareId(second)).toBe(true);
    expect(first).not.toBe(second);

    // Confirms it actually goes through the collection, not a shortcut.
    expect(mockCollection).toHaveBeenCalledWith({}, SHARED_GAMES_COLLECTION);
    expect(mockDoc).toHaveBeenCalledTimes(2);
  });

  it('does not write anything — it is a pure local id mint', () => {
    mockDoc.mockImplementationOnce((...args: any[]) => ({ id: randomAutoId(), __col: (args[0] as any).__col }));
    mintShareId();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

describe('publishSharedGame', () => {
  const params = { uid: 'u1', game, balances, settlements, totalPot: 200 };

  it('mints a new auto-ID doc when game.shareId is absent, and writes exactly five keys', async () => {
    const id = await publishSharedGame(params);

    expect(mockCollection).toHaveBeenCalledWith({}, SHARED_GAMES_COLLECTION);
    // doc() called with a single arg (the collection ref) — the auto-ID form.
    expect(mockDoc).toHaveBeenCalledWith({ __col: SHARED_GAMES_COLLECTION });
    expect(id).toBe('abcdefghij0123456789ZZ'.slice(0, 20));

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, body] = mockSetDoc.mock.calls[0];
    expect(ref.id).toBe(id);
    expect(Object.keys(body).sort()).toEqual(
      ['createdAt', 'expiresAt', 'ownerUid', 'schema', 'snapshot'].sort(),
    );
    expect(body.ownerUid).toBe('u1');
  });

  it('reuses game.shareId when present, so a re-share refreshes the existing doc', async () => {
    const existingId = 'existingShareId000001';
    const gameWithShareId: Game = { ...game, shareId: existingId };

    const id = await publishSharedGame({ ...params, game: gameWithShareId });

    expect(id).toBe(existingId);
    // doc() called with the 3-arg (db, collectionPath, docId) form — no
    // fresh auto-ID collection() lookup for the mint path.
    expect(mockDoc).toHaveBeenCalledWith({}, SHARED_GAMES_COLLECTION, existingId);
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc.mock.calls[0][0].id).toBe(existingId);
  });
});

describe('fetchSharedGame', () => {
  const ts = (d: Date) => ({ toDate: () => d });
  const shareId = 'abcdefghij0123456789';

  it('returns the deserialized doc when it exists', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        ownerUid: 'u1',
        createdAt: ts(NOW),
        expiresAt: ts(new Date(NOW.getTime() + 30 * DAY)),
        schema: 1,
        snapshot: { ...snapshot, date: ts(NOW) },
      }),
    });

    const doc = await fetchSharedGame(shareId);
    expect(doc).not.toBeNull();
    expect(doc!.ownerUid).toBe('u1');
    expect(doc!.snapshot.gameName).toBe('Friday Night');
  });

  it('returns null when the document does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    const doc = await fetchSharedGame(shareId);
    expect(doc).toBeNull();
  });

  it('returns null on a permission-denied rejection (Ruling 5: expired/nonexistent reads are DENIED, not not-found)', async () => {
    // The rules' `allow get` dereferences resource.data.expiresAt, which is
    // null for a nonexistent document — Firestore denies the read outright
    // instead of returning "not found". Without this mapping, getDoc would
    // throw for both a swept-by-TTL doc and a still-present-but-expired one,
    // and both would fall into a generic error branch instead of the
    // dedicated "this shared game has expired" UI.
    mockGetDoc.mockRejectedValueOnce({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });
    const doc = await fetchSharedGame(shareId);
    expect(doc).toBeNull();
  });

  it('rethrows a genuine transport error rather than swallowing it as missing', async () => {
    mockGetDoc.mockRejectedValueOnce({ code: 'unavailable', message: 'network down' });
    await expect(fetchSharedGame(shareId)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('deleteSharedGame', () => {
  it('deletes the document at /sharedGames/{shareId}', async () => {
    await deleteSharedGame('aB3dEfGh1JkLmN0pQrSt');
    expect(mockDeleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'aB3dEfGh1JkLmN0pQrSt', __col: SHARED_GAMES_COLLECTION }),
    );
  });
});
