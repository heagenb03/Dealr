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
//     to createdAt for games that have never been synced to Firestore).
//
// Notes:
//   - saveGame / deleteGame read the current AsyncStorage state, mutate it,
//     and write it back. This is safe for sequential user-driven operations.
//   - Firestore writes are fire-and-forget — failures are logged but do not
//     block the local operation or surface errors to the user.
// ---------------------------------------------------------------------------

// Games with a local write/delete not yet confirmed in Firestore, ref-counted by
// number of in-flight writes. The background merge keeps the local version while a
// game's count is > 0 (the in-flight remote is stale for it). Ref-counting (not a
// plain Set) is required so that when a game gets rapid successive edits, the FIRST
// write's confirmation does not clear protection while a LATER write is still pending.
const pendingSaves = new Map<string, number>();
const pendingDeletes = new Map<string, number>();

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
    const local = await StorageService.loadGames();
    const localWithDates = local.map(deserializeSyncedAt);

    if (uid) {
      // Fire background Firestore sync — non-blocking
      (async () => {
        try {
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
        .then(() => {
          unmarkPending(pendingSaves, game.id);
        })
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
      markPending(pendingDeletes, gameId);
      pendingSaves.delete(gameId);   // a delete fully supersedes any pending save for this id
    }

    try {
      await withStorageLock(async () => {
        const current = await StorageService.loadGames();
        const updated = current.filter(g => g.id !== gameId);
        await StorageService.saveGames(updated);
      });
    } catch (err) {
      if (uid) unmarkPending(pendingDeletes, gameId);
      throw err;
    }

    if (uid) {
      deleteGameFromFirestore(uid, gameId)
        .then(() => {
          unmarkPending(pendingDeletes, gameId);
        })
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
   * Drop all pending-mutation tracking. Call on user switch / sign-out so stale
   * gameIds can't protect or exclude a same-id game belonging to the next user.
   */
  static clearPendingMutations(): void {
    pendingSaves.clear();
    pendingDeletes.clear();
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
 * Recovery for two separate write-back defects, both of which strand an intact
 * copy on remote while local `syncedAt` ties it — and mergeGames' strict `>`
 * hands every tie to local, so without this union the intact remote copy would
 * stay unreachable:
 *   1. The whitelist bug in StorageService.loadGames(), which dropped
 *      preferredPayment and savedPlayerId on every read. That loss only ever
 *      reached AsyncStorage on the launch path (the background merge writes
 *      locally, never to Firestore), so remote frequently still holds the handle.
 *   2. A shipped 2.0.2 client, which never learned about methods/defaultMethod
 *      and writes players back through its own field whitelist — so a device
 *      still running 2.0.2 silently strips those two fields on every save,
 *      while a device that has since updated keeps writing them to remote.
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

    const preferredPayment = lp.preferredPayment ?? rp.preferredPayment;
    const savedPlayerId = lp.savedPlayerId ?? rp.savedPlayerId;
    // methods and defaultMethod are adopted together, from whichever side supplied
    // methods — see the doc comment above for why they can't be resolved independently.
    const methods = lp.methods ?? rp.methods;
    const defaultMethod = lp.methods ? lp.defaultMethod : rp.defaultMethod;
    if (
      preferredPayment === lp.preferredPayment &&
      savedPlayerId === lp.savedPlayerId &&
      methods === lp.methods &&
      defaultMethod === lp.defaultMethod
    ) {
      return lp;
    }

    changed = true;
    return {
      ...lp,
      ...(preferredPayment ? { preferredPayment } : {}),
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
