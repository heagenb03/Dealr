import { Game } from '@/types/game';
import { StorageService } from '@/services/storageService';
import {
  saveGameToFirestore,
  deleteGameFromFirestore,
  fetchGamesFromFirestore,
  isFirestoreOfflineError,
} from '@/services/firebaseService';
import { deleteSharedGame } from '@/services/sharedGameService';

// ---------------------------------------------------------------------------
// SyncService — offline-first dual-write with background Firestore sync.
//
// Architecture:
//   - AsyncStorage is the source of truth for reads (always available offline).
//   - Firestore is synced in the background when the user is signed in.
//   - Conflict resolution: last-write-wins by syncedAt timestamp (falls back
//     to createdAt for games that have never been synced to Firestore), EXCEPT
//     for a game holding an unconfirmed local write — see below.
//
// Notes:
//   - saveGame / deleteGame read the current AsyncStorage state, mutate it,
//     and write it back. This is safe for sequential user-driven operations.
//   - Firestore writes are fire-and-forget — failures are logged but do not
//     block the local operation or surface errors to the user.
//   - Unconfirmed writes are tracked in AsyncStorage, not just in memory, and are
//     re-sent on the next launch. syncedAt cannot rank them: the local copy's
//     syncedAt is always one server-ack stale (the server stamps it and nothing
//     reads that stamp back), so an OLDER remote routinely carries a NEWER
//     timestamp, and a merge that trusted it would delete the newer local edit.
//     A game with an unconfirmed write therefore beats a newer remote outright,
//     and the re-push then makes it the newest remote. The cost is deliberate: a
//     real edit made on another device in that window is overwritten. Losing a
//     buy-in during a live game is the worse outcome.
// ---------------------------------------------------------------------------

// Games with a local write/delete not yet confirmed in Firestore, ref-counted by
// number of in-flight writes. The background merge keeps the local version while a
// game's count is > 0 (the in-flight remote is stale for it). Ref-counting (not a
// plain Set) is required so that when a game gets rapid successive edits, the FIRST
// write's confirmation does not clear protection while a LATER write is still pending.
const pendingSaves = new Map<string, number>();
const pendingDeletes = new Map<string, number>();

// Both maps die with the process, and iOS reclaiming a suspended app is enough to kill
// it — no force-quit needed. An unconfirmed write that loses its protection is then
// destroyed by the very next merge, because mergeGames ranks the local copy by a
// syncedAt that is ALWAYS one server-ack stale (saveGameToFirestore strips syncedAt and
// lets the server stamp it, and nothing reads that stamp back), so an OLDER remote
// routinely carries a NEWER timestamp. StorageService.savePendingMutations is the
// durable twin that survives the restart.
//
// Ref counts are deliberately NOT persisted. Across a restart the in-flight writes are
// gone, so the only thing a marker has to answer is "did this game have an unconfirmed
// write when the process died" — a boolean. A hydrated marker enters the map at 1 and
// is cleared by its re-push ack.
//
// Ids restored from the durable store, i.e. writes whose process died. ONLY these get
// re-pushed: a marker created in THIS process still has a live Firestore promise that
// will settle on its own, and pushing it again would ack twice and release protection
// while a later edit is still pending.
const hydratedIds = new Set<string>();

// The uid the durable markers belong to. Stamped on every persist and checked on
// hydrate: GameContext swallows a failed StorageService.clearAll() on user switch, and
// flushOutbox below PUSHES, so an unowned marker could write the previous account's
// game into the next account's collection.
let markerUid: string | null = null;

// The uid the durable markers have already been folded in for. Hydration is a
// once-per-uid job: after it runs, the in-memory maps are authoritative and the only
// new markers are ones this process wrote. Re-running it on every loadGames would put
// a storage-lock wait on the reconnect re-sync path — which sets loading=true and, if
// a save happens to hold the lock, holds the spinner up for no gain. loadGames did not
// touch the lock at all before this change.
let hydratedForUid: string | null = null;

function markPending(map: Map<string, number>, id: string): void {
  map.set(id, (map.get(id) ?? 0) + 1);
}

function unmarkPending(map: Map<string, number>, id: string): void {
  const remaining = (map.get(id) ?? 0) - 1;
  if (remaining > 0) map.set(id, remaining);
  else map.delete(id);
}

// Serialize AsyncStorage read-modify-write sequences. AsyncStorage has no
// transactions, so a concurrent saveGame and background merge can otherwise
// interleave across awaits and clobber each other. Ops run one at a time in
// submission order; a rejected op is isolated so it can't deadlock the chain.
let storageLock: Promise<unknown> = Promise.resolve();

export function withStorageLock<T>(op: () => Promise<T>): Promise<T> {
  const run = storageLock.then(op, op);
  storageLock = run.then(() => {}, () => {});
  return run;
}

/**
 * Write both maps out as id lists. Never throws: the game write it accompanies has
 * already landed, and losing the marker costs only cross-restart protection, so it must
 * not fail the save the user just made.
 */
async function persistPending(): Promise<void> {
  try {
    await StorageService.savePendingMutations({
      uid: markerUid,
      saves: Array.from(pendingSaves.keys()),
      deletes: Array.from(pendingDeletes.keys()),
    });
  } catch (err) {
    console.warn('SyncService: failed to persist pending-mutation markers', err);
  }
}

/**
 * Fold the durable markers back into the in-memory maps. Call inside the storage lock:
 * run unserialised it can interleave with a release below and resurrect a marker that
 * was just cleared, which would protect that game forever.
 */
async function hydratePending(uid: string): Promise<void> {
  const stored = await StorageService.loadPendingMutations();
  if (stored.uid !== uid) {
    // Another account's markers (or a pre-stamp file). Never push these — drop them.
    if (stored.saves.length > 0 || stored.deletes.length > 0) {
      console.warn('SyncService: discarding pending-mutation markers owned by another user');
    }
    markerUid = uid;
    hydratedForUid = uid;
    await persistPending();
    return;
  }
  markerUid = uid;
  hydratedForUid = uid;
  for (const id of stored.saves) {
    if (pendingSaves.has(id)) continue;
    pendingSaves.set(id, 1);
    hydratedIds.add(id);
  }
  for (const id of stored.deletes) {
    if (pendingDeletes.has(id)) continue;
    pendingDeletes.set(id, 1);
    hydratedIds.add(id);
  }
}

/** Release one reference and update the durable store, serialised against hydration. */
function releasePending(map: Map<string, number>, id: string): Promise<void> {
  return withStorageLock(async () => {
    unmarkPending(map, id);
    await persistPending();
  });
}

/**
 * Re-send every write the last process died holding. This is what makes the durable
 * markers an OUTBOX rather than just a merge guard: without it, a marker whose write was
 * lost with the process would never be acked, and its game would stay protected against
 * remote updates forever — the permanent lock the clearPendingMutations tests exist to
 * rule out.
 *
 * It also means game writes no longer depend on Firestore keeping its own queue across a
 * restart, which on React Native it does NOT: firebaseService.ts configures
 * memoryLocalCache, so nothing Firestore is holding survives the process.
 *
 * Each id is pushed at most once per hydration — hydratedIds is drained up front, so a
 * reconnect-triggered loadGames cannot double-push and ack away live protection.
 */
async function flushOutbox(uid: string): Promise<void> {
  if (hydratedIds.size === 0) return;
  const ids = Array.from(hydratedIds);
  hydratedIds.clear();

  // A pending delete supersedes a pending save for the same id, exactly as the supersede
  // lines in saveGame/deleteGame below do.
  const deletes = ids.filter(id => pendingDeletes.has(id));
  const saves = ids.filter(id => pendingSaves.has(id) && !pendingDeletes.has(id));

  for (const id of deletes) {
    deleteGameFromFirestore(uid, id).then(
      () => releasePending(pendingDeletes, id),
      err => {
        if (isFirestoreOfflineError(err)) {
          console.debug('SyncService: outbox delete deferred — device offline');
          return;
        }
        console.warn('SyncService: outbox delete failed', err);
      },
    );
  }

  if (saves.length === 0) return;
  const byId = new Map((await StorageService.loadGames()).map(g => [g.id, g]));
  for (const id of saves) {
    const game = byId.get(id);
    if (!game) {
      // Marked, but gone locally and not marked deleted either — nothing left to push,
      // so drop the marker rather than protect a game that does not exist.
      await releasePending(pendingSaves, id);
      continue;
    }
    saveGameToFirestore(uid, game).then(
      () => releasePending(pendingSaves, id),
      err => {
        if (isFirestoreOfflineError(err)) {
          console.debug('SyncService: outbox save deferred — device offline');
          return;
        }
        console.warn('SyncService: outbox save failed', err);
      },
    );
  }
}

export class SyncService {
  /**
   * Load games from AsyncStorage immediately (offline-first), then kick off a
   * background Firestore fetch if the user is signed in. The background merge
   * result is delivered via `onRemoteUpdate` when available.
   */
  static async loadGames(
    uid: string | null,
    onRemoteUpdate?: (games: Game[]) => void,
    signal?: AbortSignal,
  ): Promise<Game[]> {
    if (uid && hydratedForUid !== uid) {
      // Restore protection for writes the LAST process died holding, before the
      // background merge below can read the maps. Under the storage lock so it cannot
      // interleave with a release and resurrect a marker that was just cleared.
      //
      // Once per uid, not once per call: a uid CHANGE must re-check the marker owner,
      // but a reconnect re-sync has nothing to restore and should not wait on the lock.
      await withStorageLock(() => hydratePending(uid));
    }

    const local = await StorageService.loadGames();
    const localWithDates = local.map(deserializeSyncedAt);

    if (uid) {
      // Fire background Firestore sync — non-blocking
      (async () => {
        try {
          // Re-send anything hydrated above. Fire-and-forget: the merge must not wait on
          // it, and a marker whose push fails stays marked on purpose.
          flushOutbox(uid).catch(err => console.warn('SyncService: outbox flush failed', err));

          const remote = await fetchGamesFromFirestore(uid);
          if (signal?.aborted) return;
          // Re-read local storage NOW, not the snapshot captured at load time.
          // A user edit made while this fetch was in flight (e.g. deleting a
          // player right after an app reload) has already been written to
          // AsyncStorage; merging the stale load-time snapshot would silently
          // resurrect it. Reading fresh local here folds that edit into the merge.
          const reconciled = await withStorageLock(async () => {
            const currentLocal = (await StorageService.loadGames()).map(deserializeSyncedAt);
            const merged = SyncService.mergeGames(currentLocal, remote);
            const next = applyPendingMutations(
              merged,
              currentLocal,
              new Set(pendingSaves.keys()),
              new Set(pendingDeletes.keys()),
            );
            await StorageService.saveGames(next);
            return next;
          });
          if (signal?.aborted) return;
          onRemoteUpdate?.(reconciled);
        } catch (err) {
          if (signal?.aborted) return;
          // Offline errors are expected — the app is offline-first and the user
          // sees the offline strip in the tab header, so downgrade to a silent debug log.
          if (isFirestoreOfflineError(err)) {
            console.debug('SyncService: skipping background sync — device offline');
            return;
          }
          console.warn('SyncService: background Firestore sync failed', err);
        }
      })();
    }

    return localWithDates;
  }

  /**
   * Persist a game locally (AsyncStorage) and asynchronously write it to
   * Firestore if the user is signed in.
   */
  static async saveGame(uid: string | null, game: Game): Promise<void> {
    if (uid) {
      markerUid = uid;
      markPending(pendingSaves, game.id);
      pendingDeletes.delete(game.id);   // a save fully supersedes any pending delete for this id
    }

    // Read current local state, patch the target game, write back
    try {
      await withStorageLock(async () => {
        const current = await StorageService.loadGames();
        const withDates = current.map(deserializeSyncedAt);
        const exists = withDates.some(g => g.id === game.id);
        const updated = exists
          ? withDates.map(g => (g.id === game.id ? game : g))
          : [...withDates, game];
        await StorageService.saveGames(updated);
        // AFTER the game write, so a failed write never leaves a durable marker for
        // content that was never stored.
        if (uid) await persistPending();
      });
    } catch (err) {
      // Local write failed — release the protection we optimistically added so this
      // id can't be stranded as permanently protected against future remote updates.
      if (uid) unmarkPending(pendingSaves, game.id);
      throw err;
    }

    // Fire-and-forget Firestore write
    if (uid) {
      saveGameToFirestore(uid, game)
        .then(() => releasePending(pendingSaves, game.id))
        .catch(err => {
          if (isFirestoreOfflineError(err)) {
            console.debug('SyncService: skipping Firestore save — device offline');
            return;
          }
          console.warn('SyncService: Firestore save failed', err);
        });
    }
  }

  /**
   * Remove a game locally and asynchronously delete it from Firestore.
   *
   * When the game was shared, its /sharedGames document is deleted too — the
   * link dies with the game, because there is no separate "Stop sharing"
   * control. This is only SKIPPED when signed out (`if (uid && shareId)`
   * below) — offline-with-a-uid does NOT skip it: deleteSharedGame's
   * deleteDoc enters Firestore's persisted mutation queue exactly like the
   * game delete above it, and lands on reconnect. The isFirestoreOfflineError
   * branch in the catch below is kept for symmetry with the neighbouring
   * deleteGameFromFirestore block, but it is near-dead in practice for the
   * same reason: an offline deleteDoc hangs rather than rejects, so it rarely
   * gets the chance to fire.
   *
   * The one genuine leak path is NOT "offline" alone, it's offline-THEN-
   * sign-out: firebaseService.ts's firebaseSignOut() calls `signOut(auth)`
   * with no terminate()/clearIndexedDbPersistence(), so a queued delete for
   * the signed-out uid is stranded in that user's mutation queue — it either
   * fails auth on flush or stalls until that uid signs back in. Either way
   * the share document outlives the game, and the native TTL policy is the
   * only backstop.
   */
  static async deleteGame(uid: string | null, gameId: string, shareId?: string): Promise<void> {
    if (uid) {
      markerUid = uid;
      markPending(pendingDeletes, gameId);
      pendingSaves.delete(gameId);   // a delete fully supersedes any pending save for this id
    }

    try {
      await withStorageLock(async () => {
        const current = await StorageService.loadGames();
        const updated = current.filter(g => g.id !== gameId);
        await StorageService.saveGames(updated);
        if (uid) await persistPending();
      });
    } catch (err) {
      if (uid) unmarkPending(pendingDeletes, gameId);
      throw err;
    }

    if (uid) {
      deleteGameFromFirestore(uid, gameId)
        .then(() => releasePending(pendingDeletes, gameId))
        .catch(err => {
          if (isFirestoreOfflineError(err)) {
            console.debug('SyncService: skipping Firestore delete — device offline');
            return;
          }
          console.warn('SyncService: Firestore delete failed', err);
        });
    }

    if (uid && shareId) {
      // Deliberately NOT ref-counted in pendingDeletes: that map guards the
      // local-vs-remote merge for /users/{uid}/games documents, and no merge
      // path ever reads /sharedGames.
      deleteSharedGame(shareId).catch(err => {
        if (isFirestoreOfflineError(err)) {
          console.debug('SyncService: skipping shared-game delete — device offline');
          return;
        }
        console.warn('SyncService: shared-game delete failed', err);
      });
    }
  }

  /**
   * Drop the IN-MEMORY pending-mutation tracking. Call on user switch / sign-out so
   * stale gameIds can't protect or exclude a same-id game belonging to the next user.
   *
   * The durable half is cleared by StorageService.clearAll(), which GameContext calls on
   * the same path. Splitting them is deliberate, not an oversight: clearing memory ALONE
   * is exactly what process death looks like, and that case must KEEP its markers — it
   * is the case this whole mechanism exists for.
   */
  static clearPendingMutations(): void {
    pendingSaves.clear();
    pendingDeletes.clear();
    hydratedIds.clear();
    markerUid = null;
    hydratedForUid = null;
  }

  /**
   * Merge local and remote game arrays using last-write-wins by syncedAt.
   * Falls back to createdAt for games that have never been synced.
   * Games present in only one source are included unconditionally.
   */
  private static mergeGames(local: Game[], remote: Game[]): Game[] {
    const merged = new Map<string, Game>();

    for (const game of local) {
      merged.set(game.id, game);
    }

    for (const remoteGame of remote) {
      const localGame = merged.get(remoteGame.id);
      if (!localGame) {
        // Only in Firestore — add it
        merged.set(remoteGame.id, remoteGame);
      } else {
        // In both — keep the newer version
        const localTime = localGame.syncedAt ?? localGame.createdAt;
        const remoteTime = remoteGame.syncedAt ?? remoteGame.createdAt;
        if (remoteTime > localTime) {
          merged.set(remoteGame.id, remoteGame);
        } else {
          // Local wins, but it may be a copy that the old loadGames whitelist
          // stripped. Fill only the fields it is missing from remote.
          merged.set(remoteGame.id, unionRecoverablePlayerFields(localGame, remoteGame));
        }
      }
    }

    return Array.from(merged.values());
  }
}

/**
 * StorageService doesn't know about syncedAt, so after loading from
 * AsyncStorage the field comes back as an ISO string. Convert it to a Date.
 */
function deserializeSyncedAt(game: Game & { syncedAt?: any }): Game {
  if (game.syncedAt && typeof game.syncedAt === 'string') {
    return { ...game, syncedAt: new Date(game.syncedAt) };
  }
  return game;
}

/**
 * Fill in player fields that the local copy is missing but remote still has.
 *
 * Recovery for ONE defect: the old whitelist bug in StorageService.loadGames(),
 * which dropped preferredPayment and savedPlayerId on every read. It strands an
 * intact copy on remote while local `syncedAt` ties it — and mergeGames' strict
 * `>` hands every tie to local, so without this union the intact remote copy
 * would stay unreachable. That loss only ever reached AsyncStorage on the launch
 * path (the background merge writes locally, never to Firestore), so remote
 * frequently still holds the handle.
 *
 * This does NOT recover a shipped 2.0.2 client's writes, and structurally cannot:
 * it only ever fills local from remote, and that scenario makes REMOTE the
 * impoverished side. What actually happens there, stated so no future reader
 * expects a rescue that isn't here:
 *   - 2.0.2 reads game documents through a deserializer whose player whitelist has
 *     no methods/defaultMethod (its firebaseService keeps only preferredPayment +
 *     savedPlayerId), so its in-memory copy carries just the derived
 *     preferredPayment. Editing that game writes the stripped copy back with a
 *     fresh serverTimestamp — a strictly NEWER syncedAt.
 *   - mergeGames therefore takes that remote copy wholesale (last-write-wins) and
 *     never reaches this function at all.
 *   - The DEFAULT method still survives, via the derived preferredPayment: this
 *     app dual-writes it on the way out, 2.0.2 preserves it verbatim, and
 *     deserializeFirestoreGame runs withSynthesizedMethods on the way back in,
 *     rebuilding a one-key methods map from it. The non-default methods 2.0.2
 *     could not carry are lost.
 *   - That loss is the accepted cost spec §4 already states for the saved pool,
 *     applied to the game document: a payment set is replaced as a unit by the
 *     newer write, never unioned per key.
 *   - A PASSIVE 2.0.2 device — one that loads and merges but never edits — never
 *     causes it. Its background merge writes only to AsyncStorage; verified at
 *     14846e6:frontend/services/syncService.ts, whose loadGames sync block ends in
 *     StorageService.saveGames with no Firestore write.
 *
 * One consequence of withSynthesizedMethods running on every remote read: a remote
 * player that carries any payment at all reaches this function with a methods map
 * already built, never as a bare preferredPayment. That is why nothing below reads
 * preferredPayment — there is no legacy-only shape left to read.
 *
 * Only fills fields local LACKS, so a live local value is never overwritten.
 *
 * methods and defaultMethod are adopted as a PAIR, not independently: if local
 * has a methods map at all, its defaultMethod is kept as-is (even when
 * undefined) rather than paired with remote's default. Otherwise a local player
 * carrying methods but no defaultMethod, merged against a remote copy carrying
 * both, could end up with local's map and remote's default — a pairing that
 * existed on neither device. Only when local lacks methods entirely does the
 * pair come from remote together.
 *
 * The name guard is load-bearing: the one place that deliberately drops these
 * fields is the rename re-resolve in active.tsx, which unbinds a player whose
 * new name matches 0 or 2+ saved entries — and it always changes the name. If
 * that rename was made offline, remote still holds the PREVIOUS person's handle,
 * and adopting it would attach the wrong payee to the renamed player. Matching
 * on name as well as id keeps recovery away from every deliberate unbind.
 *
 * Returns the input unchanged when nothing is recoverable, so the merge does not
 * churn object identity for callers memoising on it.
 */
export function unionRecoverablePlayerFields(local: Game, remote: Game): Game {
  const remoteById = new Map(remote.players.map(p => [p.id, p]));
  let changed = false;

  const players = local.players.map(lp => {
    const rp = remoteById.get(lp.id);
    if (!rp || rp.name !== lp.name) return lp;

    const savedPlayerId = lp.savedPlayerId ?? rp.savedPlayerId;
    // methods and defaultMethod are adopted together, from whichever side supplied
    // methods — see the doc comment above for why they can't be resolved independently.
    // preferredPayment is not recovered here: it is derived from methods/defaultMethod at
    // the serialize boundary (paymentMethods.ts), never carried on Player in memory.
    const methods = lp.methods ?? rp.methods;
    const defaultMethod = lp.methods ? lp.defaultMethod : rp.defaultMethod;
    if (savedPlayerId === lp.savedPlayerId && methods === lp.methods && defaultMethod === lp.defaultMethod) {
      return lp;
    }

    changed = true;
    return {
      ...lp,
      ...(savedPlayerId ? { savedPlayerId } : {}),
      ...(methods ? { methods, defaultMethod } : {}),
    };
  });

  return changed ? { ...local, players } : local;
}

/**
 * Reconcile a merge result against unconfirmed local mutations.
 *
 * A game with a pending local write keeps its fresh-local version regardless
 * of syncedAt (the in-flight remote is definitionally stale for it); a game
 * with a pending local delete is removed even if the merge re-added it from
 * remote. Pure — no I/O, no module state — so it is unit-testable in isolation.
 */
export function applyPendingMutations(
  merged: Game[],
  freshLocal: Game[],
  saves: Set<string>,
  deletes: Set<string>,
): Game[] {
  const localById = new Map(freshLocal.map(game => [game.id, game]));

  let result = merged.map(game =>
    saves.has(game.id) && localById.has(game.id) ? localById.get(game.id)! : game,
  );

  for (const id of saves) {
    if (localById.has(id) && !result.some(game => game.id === id)) {
      result.push(localById.get(id)!);
    }
  }

  return result.filter(game => !deletes.has(game.id));
}
