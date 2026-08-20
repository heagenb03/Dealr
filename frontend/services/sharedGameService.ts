/**
 * Read and write /sharedGames/{shareId}.
 *
 * Deliberately thin. Everything worth testing lives in the pure helpers below
 * and in utils/sharedGameSnapshot.ts; the three Firestore calls are covered by
 * the emulator rules suite (firestore-rules-tests/) and by device QA.
 *
 * Writes go through ONE document per game. publishSharedGame reuses
 * game.shareId when it is already set, so a re-share REFRESHES the link already
 * sitting in a group chat rather than minting a second one beside a stale first.
 * That is what makes the owner-update rule useful rather than merely permitted.
 */
import { doc, collection, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '@/services/firebaseService';
import { Game, PlayerBalance, Settlement } from '@/types/game';
import {
  CurrencyCode,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
} from '@/constants/Currencies';
import {
  SHARED_GAME_SCHEMA,
  SharedGameSnapshot,
  buildSharedGameSnapshot,
} from '@/utils/sharedGameSnapshot';

export const SHARED_GAMES_COLLECTION = 'sharedGames';

/**
 * Must stay at or below the rules' 31-day ceiling, which is measured against
 * SERVER time. The one-day gap is the client clock-skew allowance.
 */
export const SHARE_TTL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a share published at `now` stops being readable.
 *
 * Exported because two things need the same number: the document's own
 * `expiresAt`, and the `?e=` param buildShareUrl bakes into the link so
 * public/g/index.html can tell a recipient the link expired instead of pitching
 * an install that lands on the same message. Duplicating `now + 30 days` at the
 * call site is how those two silently drift apart.
 */
export function shareExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + SHARE_TTL_DAYS * DAY_MS);
}

export interface SharedGameDoc {
  /** Document level, NOT inside snapshot — the rules need it, and keeping it out
   *  leaves the projection purely presentational. */
  ownerUid: string;
  createdAt: Date;
  /** The field a native Firestore TTL policy is configured against. */
  expiresAt: Date;
  schema: number;
  snapshot: SharedGameSnapshot;
}

/** The document body. Pure — `now` is injected so this is testable. */
export function buildSharedGameDocument(params: {
  ownerUid: string;
  snapshot: SharedGameSnapshot;
  now: Date;
}): SharedGameDoc {
  const { ownerUid, snapshot, now } = params;
  return {
    ownerUid,
    createdAt: now,
    expiresAt: shareExpiryFrom(now),
    schema: SHARED_GAME_SCHEMA,
    snapshot,
  };
}

/** Firestore Timestamp (or an already-converted Date from the local cache) -> Date. */
function toDate(value: any): Date {
  return value?.toDate ? value.toDate() : new Date(value);
}

/**
 * Like toDate, but never returns Invalid Date: falls back to `fallback` when
 * the source is missing or unparseable. A shared game's date is rendered
 * directly in the header (see Ruling 2) — "Invalid Date" is not an acceptable
 * degradation for a corrupt or partial document.
 */
function toValidDate(value: any, fallback: Date): Date {
  const d = toDate(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function toFiniteNumber(value: any, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toNonEmptyString(value: any, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * Resolve to a currency this build can actually format. Deliberately not a
 * `?? DEFAULT_CURRENCY` downstream: that only catches nullish, so a stored
 * `''` or an unsupported code would slip through into createCurrencyFormatters,
 * which throws later at `meta.symbol` on the first formatAmount() call — on
 * the shared route that lands inside a ListHeaderComponent at render time,
 * where the route's try/catch cannot reach it. Resolving here, at the data
 * boundary, is what prevents that uncatchable render crash.
 */
function resolveCurrency(code: any): CurrencyCode {
  return typeof code === 'string' && code in SUPPORTED_CURRENCIES
    ? (code as CurrencyCode)
    : DEFAULT_CURRENCY;
}

function resolveSettlementMode(mode: any): 'optimal' | 'banker' {
  return mode === 'banker' ? 'banker' : 'optimal';
}

/**
 * Rebuild a typed document from raw Firestore data.
 *
 * Defaults and validates every scalar as well as every collection: this reads
 * a document written by a DIFFERENT installed build, which may be older or
 * newer than this one, or corrupted in transit. A missing/malformed field
 * must render an incomplete-but-safe summary, not "$NaN", "Invalid Date", or
 * a crash.
 *
 * schema in particular defaults to 0 — strictly BELOW SHARED_GAME_SCHEMA —
 * rather than being left undefined. `undefined > SHARED_GAME_SCHEMA` is
 * `false`, which would let a schema-less document silently read as current
 * and bypass the outdated/incompatible-version gate. 0 reads unambiguously as
 * "not current" under either direction of comparison.
 */
export function deserializeSharedGame(data: Record<string, any>): SharedGameDoc {
  const snapshot = data.snapshot ?? {};
  const createdAt = toValidDate(data.createdAt, new Date(0));
  const expiresAt = toValidDate(data.expiresAt, new Date(0));

  return {
    ownerUid: toNonEmptyString(data.ownerUid, ''),
    createdAt,
    expiresAt,
    schema: toFiniteNumber(data.schema, 0),
    snapshot: {
      gameName: toNonEmptyString(snapshot.gameName, 'Shared game'),
      date: toValidDate(snapshot.date, createdAt),
      currency: resolveCurrency(snapshot.currency),
      settlementMode: resolveSettlementMode(snapshot.settlementMode),
      bankerName: typeof snapshot.bankerName === 'string' ? snapshot.bankerName : undefined,
      bankerPlayerId:
        typeof snapshot.bankerPlayerId === 'string' ? snapshot.bankerPlayerId : undefined,
      totalPot: toFiniteNumber(snapshot.totalPot, 0),
      balances: Array.isArray(snapshot.balances) ? snapshot.balances : [],
      settlements: Array.isArray(snapshot.settlements) ? snapshot.settlements : [],
      payments:
        snapshot.payments && typeof snapshot.payments === 'object' && !Array.isArray(snapshot.payments)
          ? snapshot.payments
          : {},
    },
  };
}

/**
 * Mint a shareId without writing. Firestore auto-IDs are generated client-side,
 * so the host can persist game.shareId BEFORE the write acks — which is what
 * stops a timed-out-but-later-landing write from orphaning a document. See
 * Task 13's summary.tsx: it passes the minted id back in via `game.shareId`,
 * which publishSharedGame below already reuses when present.
 */
export function mintShareId(): string {
  return doc(collection(db, SHARED_GAMES_COLLECTION)).id;
}

/**
 * Write (or refresh) the share document and resolve to its id.
 *
 * Does NOT persist the id back onto the Game — the caller owns that, because it
 * holds the GameContext updater. See Task 13.
 *
 * OFFLINE CONTRACT: firebaseService.ts configures persistentLocalCache, so
 * this write does NOT reject when offline — the returned Promise resolves
 * only on BACKEND ack and otherwise stays pending indefinitely (queued, not
 * written). This function does not swallow that distinction or race it
 * against a timeout itself: it is a plain async wrapper around setDoc. Any
 * caller awaiting this inside a user interaction (Task 13's share button)
 * MUST guard with an online check and/or race it against a timeout, or the
 * interaction hangs with no error and no catch.
 */
export async function publishSharedGame(params: {
  uid: string;
  game: Game;
  balances: PlayerBalance[];
  settlements: Settlement[];
  totalPot: number;
}): Promise<string> {
  const { uid, game, balances, settlements, totalPot } = params;

  const snapshot = buildSharedGameSnapshot({ game, balances, settlements, totalPot });

  // Reuse the existing id when there is one, so the link already in a group chat
  // gets refreshed instead of orphaned. doc() with no path segment mints a
  // Firestore auto-ID (20 chars, [A-Za-z0-9]) locally, with no round trip and no
  // extra dependency.
  const ref = game.shareId
    ? doc(db, SHARED_GAMES_COLLECTION, game.shareId)
    : doc(collection(db, SHARED_GAMES_COLLECTION));

  const body = buildSharedGameDocument({ ownerUid: uid, snapshot, now: new Date() });

  // Not { merge: true }: a refresh must REPLACE the snapshot. Merging would
  // leave a removed player's balance behind in the array-free fields.
  await setDoc(ref, body);

  return ref.id;
}

/**
 * Fetch a shared game, or null if it does not exist (deleted, or TTL-expired).
 *
 * Ruling 5 / load-bearing: the rules' `allow get` reads
 * `resource.data.expiresAt > request.time`, and `resource` is null on a
 * NONEXISTENT document — that dereference errors, so Firestore DENIES the
 * read (permission-denied) rather than returning "not found". The same thing
 * happens for a document that is still present but past its expiresAt. Both
 * are the normal end state of every share under a 30-day TTL, so without this
 * mapping, permission-denied would fall into a generic catch on every route
 * that calls this, and the dedicated "this shared game has expired" UI would
 * be unreachable. A permission-denied here is therefore expected shape, not a
 * genuine authorization failure — a signed-in caller with a valid shareId is
 * otherwise always allowed. Any OTHER error code (network, unavailable, ...)
 * is a real transport failure and must still reject.
 */
export async function fetchSharedGame(shareId: string): Promise<SharedGameDoc | null> {
  let snap;
  try {
    snap = await getDoc(doc(db, SHARED_GAMES_COLLECTION, shareId));
  } catch (err: any) {
    if (err?.code === 'permission-denied') return null;
    throw err;
  }
  if (!snap.exists()) return null;
  return deserializeSharedGame(snap.data());
}

/**
 * Delete a share document. This is the REVOKE path: there is no standalone
 * "Stop sharing" control, so the link dies with the game (decision, 2026-08-20).
 *
 * `allow delete: if request.auth != null && resource.data.ownerUid ==
 * request.auth.uid` is already live in production — no rules change is needed.
 * Deleting a document that is already gone is a no-op in Firestore, so a
 * double-delete or a TTL-swept target is not an error.
 */
export async function deleteSharedGame(shareId: string): Promise<void> {
  await deleteDoc(doc(db, SHARED_GAMES_COLLECTION, shareId));
}
