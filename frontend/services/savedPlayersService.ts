import AsyncStorage from '@react-native-async-storage/async-storage';
import { PaymentCarrier, PaymentHandles, PaymentMethod, PreferredPayment } from '@/types/game';
import { withLegacyPaymentList, withSynthesizedMethods } from '@/utils/paymentMethods';
import {
  saveSavedPlayersToFirestore,
  fetchSavedPlayersFromFirestore,
  isFirestoreOfflineError,
} from '@/services/firebaseService';

/** Legacy device-global key (pre account-scoping). Migrated once per device. */
const LEGACY_KEY = 'saved_player_names';
/** Per-account local key. */
function keyFor(uid: string): string {
  return `saved_player_names:${uid}`;
}
/** Per-account local key for deletion tombstones (see Tombstones). */
function tombstonesKeyFor(uid: string): string {
  return `saved_player_tombstones:${uid}`;
}

/**
 * id -> deletedAt (epoch ms). A tombstone records that an entry was deleted so the
 * offline-first union merge can DROP a stale remote copy instead of resurrecting it —
 * a union alone cannot represent a deletion (an absent id is indistinguishable from
 * "never existed"). A tombstone only wins while it is newer than the entry's own
 * updatedAt, so a later re-add of the same id survives.
 */
export type Tombstones = Record<string, number>;

/** Cap on retained tombstones (newest-by-deletedAt) to bound stored/synced size. */
const TOMBSTONE_CAP = 500;

/** Free tier: max saved players. Pro tier: effectively unlimited (bounds storage). */
export const FREE_SAVED_CAP = 15;
export const PRO_SAVED_CAP = 200;

/** The effective saved-players cap for a tier. */
export function savedCapFor(isPro: boolean): number {
  return isPro ? PRO_SAVED_CAP : FREE_SAVED_CAP;
}

/**
 * Whether a NEW saved player can still be added at this count. Gate on count vs
 * the tier cap — never on tier alone: free users may add until their cap is full.
 */
export function canAddMoreSavedPlayers(count: number, isPro: boolean): boolean {
  return count < savedCapFor(isPro);
}

export interface SavedPlayer {
  id: string;
  name: string;
  preferredPayment?: PreferredPayment;
  methods?: PaymentHandles;
  defaultMethod?: PaymentMethod;
  /** Epoch ms of the last edit; tie-breaker for cross-device union merge. */
  updatedAt?: number;
}

/** Random opaque id for a newly created saved player (mirrors gameService id style). */
export function newSavedPlayerId(): string {
  return `sp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Deterministic id for a legacy entry that predates the id field. Derived from the
 * lowercased name so two devices migrating the SAME legacy list independently produce
 * identical ids — union-by-id then dedups instead of doubling the person.
 */
export function legacyIdFor(name: string): string {
  return `legacy:${name.trim().toLowerCase()}`;
}

/** Coerce a raw stored entry (legacy string or object) into a SavedPlayer. */
function coerce(entry: unknown): SavedPlayer | null {
  if (typeof entry === 'string') return { id: legacyIdFor(entry), name: entry };
  if (entry && typeof entry === 'object' && typeof (entry as any).name === 'string') {
    const e = entry as {
      id?: string;
      name: string;
      preferredPayment?: PreferredPayment;
      methods?: PaymentHandles;
      defaultMethod?: PaymentMethod;
      updatedAt?: number;
    };
    const out: SavedPlayer = {
      id: typeof e.id === 'string' && e.id ? e.id : legacyIdFor(e.name),
      name: e.name,
    };
    if (e.preferredPayment) out.preferredPayment = e.preferredPayment;
    if (e.methods) out.methods = e.methods;
    if (e.defaultMethod) out.defaultMethod = e.defaultMethod;
    if (typeof e.updatedAt === 'number') out.updatedAt = e.updatedAt;
    return withSynthesizedMethods(out);
  }
  return null;
}

/**
 * Collapse entries that share an id, keeping the greater-updatedAt copy (missing → 0) and
 * preserving first-seen order. Coercion can mint the SAME deterministic `legacy:<name>` id
 * for two id-less same-name entries, so any list built by coercing raw (local or remote)
 * data must pass through here before it reaches unionMerge or the UI — otherwise two rows
 * collide on `key={p.id}`.
 */
function dedupeById(list: SavedPlayer[]): SavedPlayer[] {
  const byId = new Map<string, SavedPlayer>();
  for (const entry of list) {
    const existing = byId.get(entry.id);
    if (!existing || (entry.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values());
}

/** Coerce every raw entry into a SavedPlayer and dedupe by id. */
function normalize(entries: unknown[]): SavedPlayer[] {
  return dedupeById(entries.map(coerce).filter((p): p is SavedPlayer => p !== null));
}

function parseList(raw: string | null): SavedPlayer[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return normalize(parsed);
}

/**
 * Read the uid-scoped list. If it is absent AND the legacy global key still holds
 * data, adopt that data into this uid once (stamping updatedAt), then delete the
 * legacy key. Runs at most once per device — the first uid to open the app wins.
 */
async function readLocal(uid: string): Promise<SavedPlayer[]> {
  const scoped = await AsyncStorage.getItem(keyFor(uid));
  if (scoped !== null) return parseList(scoped);

  const legacy = await AsyncStorage.getItem(LEGACY_KEY);
  if (legacy === null) return [];

  const now = Date.now();
  const migrated = parseList(legacy).map(p => (p.updatedAt ? p : { ...p, updatedAt: now }));
  // Route through writeLocal (not a direct setItem) so the migrated list gets the same
  // derived-preferredPayment dual-write every other local write gets (spec §2) — `migrated`
  // came from parseList -> coerce, which already stripped the legacy field on the way in.
  await writeLocal(uid, migrated);
  await AsyncStorage.removeItem(LEGACY_KEY);
  return migrated;
}

/**
 * Attaches the derived legacy `preferredPayment` to each entry before it hits storage (spec
 * §2's dual-write, applied at the serialize boundary rather than inside whichever function
 * built the entry — every local write funnels through here, so no write path can forget it).
 */
async function writeLocal(uid: string, players: SavedPlayer[]): Promise<void> {
  await AsyncStorage.setItem(keyFor(uid), JSON.stringify(withLegacyPaymentList(players)));
}

/** Read the uid-scoped tombstone map ({} when absent or malformed). */
async function readTombstones(uid: string): Promise<Tombstones> {
  const raw = await AsyncStorage.getItem(tombstonesKeyFor(uid));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Tombstones = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof ts === 'number') out[id] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeTombstones(uid: string, tombstones: Tombstones): Promise<void> {
  await AsyncStorage.setItem(tombstonesKeyFor(uid), JSON.stringify(tombstones));
}

/**
 * Write players + tombstones to local storage and fire-and-forget to Firestore.
 * Every mutating op funnels through here so local and remote never diverge on which
 * entries are deleted.
 */
async function commit(uid: string, players: SavedPlayer[], tombstones: Tombstones): Promise<void> {
  await writeLocal(uid, players);
  await writeTombstones(uid, tombstones);
  pushRemote(uid, players, tombstones);
}

/** Push the full list + tombstones to Firestore (fire-and-forget; offline is swallowed). */
function pushRemote(uid: string, players: SavedPlayer[], tombstones: Tombstones): void {
  saveSavedPlayersToFirestore(uid, withLegacyPaymentList(players), tombstones).catch(err => {
    if (isFirestoreOfflineError(err)) {
      console.debug('savedPlayers: skipping Firestore save — device offline');
      return;
    }
    console.warn('savedPlayers: Firestore save failed', err);
  });
}

/** True when a tombstone deletes this entry — i.e. the delete is newer than the entry. */
function isTombstoned(entry: SavedPlayer, tombstones: Tombstones): boolean {
  const deletedAt = tombstones[entry.id];
  return deletedAt !== undefined && deletedAt > (entry.updatedAt ?? 0);
}

/** Merge two tombstone maps, keeping the greater deletedAt per id. */
function mergeTombstones(a: Tombstones, b: Tombstones): Tombstones {
  const out: Tombstones = { ...a };
  for (const [id, ts] of Object.entries(b)) {
    if (out[id] === undefined || ts > out[id]) out[id] = ts;
  }
  return out;
}

/** Drop the tombstone for an id that is being (re)written as a live entry. */
function clearTombstone(tombstones: Tombstones, id: string): Tombstones {
  if (tombstones[id] === undefined) return tombstones;
  const { [id]: _removed, ...rest } = tombstones;
  return rest;
}

/**
 * Drop tombstones superseded by a live entry (a re-add newer than the delete), then cap
 * to the newest TOMBSTONE_CAP by deletedAt so the map can't grow without bound.
 */
function pruneTombstones(tombstones: Tombstones, livePlayers: SavedPlayer[]): Tombstones {
  const liveById = new Map(livePlayers.map(p => [p.id, p]));
  const kept: Tombstones = {};
  for (const [id, deletedAt] of Object.entries(tombstones)) {
    const live = liveById.get(id);
    if (live && (live.updatedAt ?? 0) >= deletedAt) continue; // re-added after the delete
    kept[id] = deletedAt;
  }
  const ids = Object.keys(kept);
  if (ids.length <= TOMBSTONE_CAP) return kept;
  ids.sort((x, y) => kept[y] - kept[x]);
  const capped: Tombstones = {};
  for (const id of ids.slice(0, TOMBSTONE_CAP)) capped[id] = kept[id];
  return capped;
}

/**
 * Union two lists by id. For an id in both, keep the entry with the greater updatedAt
 * (missing → 0). Any entry deleted by a newer tombstone is dropped, so a stale remote
 * copy of a just-deleted player is not resurrected. Result sorted by updatedAt desc so
 * the most recently touched entry sorts first.
 */
export function unionMerge(
  local: SavedPlayer[],
  remote: SavedPlayer[],
  tombstones: Tombstones = {},
): SavedPlayer[] {
  const byId = new Map<string, SavedPlayer>();
  for (const entry of [...remote, ...local]) {
    const existing = byId.get(entry.id);
    if (!existing || (entry.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values())
    .filter(entry => !isTombstoned(entry, tombstones))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * Module-level promise queue serializing every mutating read-modify-write op.
 * Without this, concurrent/un-awaited calls can race: both read the same
 * pre-mutation snapshot and the second writeLocal() clobbers the first.
 */
let writeChain: Promise<void> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeChain.then(fn);
  writeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function getSavedPlayers(uid: string): Promise<SavedPlayer[]> {
  return enqueue(() => readLocal(uid));
}

export async function getSavedPlayerNames(uid: string): Promise<string[]> {
  return (await getSavedPlayers(uid)).map(p => p.name);
}

export async function getSavedPlayer(uid: string, name: string): Promise<SavedPlayer | undefined> {
  const lower = name.toLowerCase();
  return (await getSavedPlayers(uid)).find(p => p.name.toLowerCase() === lower);
}

export async function getSavedPlayerById(uid: string, id: string): Promise<SavedPlayer | undefined> {
  return (await getSavedPlayers(uid)).find(p => p.id === id);
}

/** ALL saved players whose name matches (case-insensitive). Empty array if none. */
export async function getSavedPlayersByName(uid: string, name: string): Promise<SavedPlayer[]> {
  const lower = name.trim().toLowerCase();
  return (await getSavedPlayers(uid)).filter(p => p.name.toLowerCase() === lower);
}

/**
 * Create a saved player with its own opaque id. Saved names must stay distinct, so this
 * REJECTS a name that already matches an existing saved entry (trimmed, case-insensitive)
 * with reason 'duplicate'. The cap is honored for new entries and is checked AFTER the
 * duplicate guard, so a colliding name reports 'duplicate' rather than 'full'. Returns the
 * new id on success.
 */
export async function createSavedPlayer(
  uid: string,
  name: string,
  payment?: PaymentCarrier,
  limit: number = PRO_SAVED_CAP,
): Promise<{ ok: true; id: string } | { ok: false; reason: 'full' | 'empty' | 'duplicate' }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  return enqueue(async () => {
    const current = await readLocal(uid);
    const lower = trimmed.toLowerCase();
    // Distinct saved names are an invariant — the explicit "separate person" action must
    // use a distinct name (the UI prompts for one; this is the backstop). Checked before the
    // cap so the user gets the more specific reason.
    if (current.some(p => p.name.toLowerCase() === lower)) {
      return { ok: false, reason: 'duplicate' } as const;
    }
    if (current.length >= limit) return { ok: false, reason: 'full' } as const;
    const entry: SavedPlayer = { id: newSavedPlayerId(), name: trimmed, updatedAt: Date.now() };
    // preferredPayment is NOT assigned here — it is derived at the writeLocal/pushRemote
    // serialize boundary (spec §2), never carried in memory. Assigning it here would leak:
    // any write path that builds an entry a different way (there are none today, but the
    // point is that a NEW one wouldn't have to remember this) would silently drop it.
    if (payment?.methods) {
      entry.methods = payment.methods;
      entry.defaultMethod = payment.defaultMethod;
    }
    const next = [entry, ...current];
    const tombstones = clearTombstone(await readTombstones(uid), entry.id);
    await commit(uid, next, tombstones);
    return { ok: true, id: entry.id } as const;
  });
}

/** Patch an existing entry by id (name and/or payment). Returns false if the id is absent. */
export async function updateSavedPlayer(
  uid: string,
  id: string,
  patch: { name?: string } & PaymentCarrier,
): Promise<boolean> {
  return enqueue(async () => {
    const current = await readLocal(uid);
    const idx = current.findIndex(p => p.id === id);
    if (idx === -1) return false;
    const nextName = patch.name?.trim();
    if (nextName) {
      const lower = nextName.toLowerCase();
      // Saved names must stay distinct — reject a rename onto a DIFFERENT entry's name.
      if (current.some(p => p.id !== id && p.name.toLowerCase() === lower)) return false;
    }
    const prev = current[idx];
    const updated: SavedPlayer = {
      id: prev.id,
      name: patch.name?.trim() ? patch.name.trim() : prev.name,
      updatedAt: Date.now(),
    };
    // Whole-map replace, not a per-key union (spec §4). `patch.methods === undefined` means
    // "not patching payment" — e.g. the recency-bump call updateSavedPlayer(uid, sid, {}).
    // preferredPayment is derived at the serialize boundary (see writeLocal/pushRemote), not
    // assigned here — see the note in createSavedPlayer.
    const methods = patch.methods ?? prev.methods;
    const defaultMethod = patch.methods ? patch.defaultMethod : prev.defaultMethod;
    if (methods) {
      updated.methods = methods;
      updated.defaultMethod = defaultMethod;
    }
    const next = current.map((p, i) => (i === idx ? updated : p));
    const tombstones = clearTombstone(await readTombstones(uid), id);
    await commit(uid, next, tombstones);
    return true;
  });
}

export async function deleteSavedPlayerById(uid: string, id: string): Promise<void> {
  return enqueue(async () => {
    const current = await readLocal(uid);
    const next = current.filter(p => p.id !== id);
    const tombstones = { ...(await readTombstones(uid)), [id]: Date.now() };
    await commit(uid, next, tombstones);
  });
}

export async function deleteSavedPlayersByIds(uid: string, ids: string[]): Promise<void> {
  return enqueue(async () => {
    const idSet = new Set(ids);
    const current = await readLocal(uid);
    const next = current.filter(p => !idSet.has(p.id));
    const now = Date.now();
    const tombstones = { ...(await readTombstones(uid)) };
    for (const id of ids) tombstones[id] = now;
    await commit(uid, next, tombstones);
  });
}

/**
 * Persist a saved player. Updating an existing entry (case-insensitive) is always
 * allowed and moves it to the front. A brand-new entry is only added while the list
 * is under `limit`; at/over the limit the new name is dropped. Existing entries are
 * never truncated. With opts.updateOnly, a missing entry is a no-op — the in-game payment
 * editor must never create or resurrect entries.
 */
export async function savePlayer(
  uid: string,
  name: string,
  payment?: PaymentCarrier,
  limit: number = PRO_SAVED_CAP,
  opts?: { updateOnly?: boolean },
): Promise<void> {
  return enqueue(async () => {
    const current = await readLocal(uid);
    const lower = name.toLowerCase();
    const existing = current.find(p => p.name.toLowerCase() === lower);
    if (!existing && opts?.updateOnly) return; // update-only: never create an entry
    if (!existing && current.length >= limit) return; // list full — do not add a new name
    const merged: SavedPlayer = { id: existing?.id ?? legacyIdFor(name), name, updatedAt: Date.now() };
    // Whole-map replace, not a per-key union (spec §4); preferredPayment is derived at the
    // serialize boundary, not assigned here — see the note in createSavedPlayer.
    const methods = payment?.methods ?? existing?.methods;
    const defaultMethod = payment?.methods ? payment.defaultMethod : existing?.defaultMethod;
    if (methods) {
      merged.methods = methods;
      merged.defaultMethod = defaultMethod;
    }
    const deduped = [merged, ...current.filter(p => p.name.toLowerCase() !== lower)];
    const tombstones = clearTombstone(await readTombstones(uid), merged.id);
    await commit(uid, deduped, tombstones);
  });
}

/** Backward-compatible wrapper for callers that only have a name. */
export async function savePlayerName(uid: string, name: string, limit: number = PRO_SAVED_CAP): Promise<void> {
  return savePlayer(uid, name, undefined, limit);
}

/** Remove one saved player (case-insensitive). */
export async function deleteSavedPlayer(uid: string, name: string): Promise<void> {
  return enqueue(async () => {
    const lower = name.toLowerCase();
    const current = await readLocal(uid);
    const next = current.filter(p => p.name.toLowerCase() !== lower);
    const now = Date.now();
    const tombstones = { ...(await readTombstones(uid)) };
    for (const p of current) if (p.name.toLowerCase() === lower) tombstones[p.id] = now;
    await commit(uid, next, tombstones);
  });
}

export type RenameResult = { ok: true } | { ok: false; reason: 'empty' | 'notfound' | 'duplicate' };

/**
 * Rename a saved player by id. Names must stay distinct (id is the identity), so a rename
 * onto a DIFFERENT saved entry's name is rejected with reason 'duplicate'. A case-only
 * self-rename is allowed. Preserves id + payment; bumps updatedAt via updateSavedPlayer.
 */
export async function renameSavedPlayer(uid: string, id: string, newName: string): Promise<RenameResult> {
  const trimmed = newName.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  const list = await getSavedPlayers(uid);
  const lower = trimmed.toLowerCase();
  if (list.some(p => p.id !== id && p.name.toLowerCase() === lower)) return { ok: false, reason: 'duplicate' };
  if (!list.some(p => p.id === id)) return { ok: false, reason: 'notfound' };
  const ok = await updateSavedPlayer(uid, id, { name: trimmed });
  return ok ? { ok: true } : { ok: false, reason: 'notfound' };
}

/** Remove several saved players at once (case-insensitive). */
export async function deleteSavedPlayers(uid: string, names: string[]): Promise<void> {
  return enqueue(async () => {
    const lowerSet = new Set(names.map(n => n.toLowerCase()));
    const current = await readLocal(uid);
    const next = current.filter(p => !lowerSet.has(p.name.toLowerCase()));
    const now = Date.now();
    const tombstones = { ...(await readTombstones(uid)) };
    for (const p of current) if (lowerSet.has(p.name.toLowerCase())) tombstones[p.id] = now;
    await commit(uid, next, tombstones);
  });
}

/**
 * Bulk add. For each entry: blank names are skipped; an existing name (case-insensitive)
 * is merged (payment updated only if the entry supplies one); a new name is added while
 * under `limit`, else counted as `skippedFull`. Returns per-outcome counts.
 */
export async function addSavedPlayers(
  uid: string,
  entries: Omit<SavedPlayer, 'id'>[],
  opts: { limit: number },
): Promise<{ added: number; updated: number; skippedFull: number }> {
  return enqueue(async () => {
    const result = await readLocal(uid);
    let tombstones = await readTombstones(uid);
    let added = 0;
    let updated = 0;
    let skippedFull = 0;
    const now = Date.now();
    for (const entry of entries) {
      const name = entry.name.trim();
      if (!name) continue;
      const lower = name.toLowerCase();
      const idx = result.findIndex(p => p.name.toLowerCase() === lower);
      if (idx !== -1) {
        if (entry.preferredPayment) {
          result[idx] = {
            id: result[idx].id,
            name: result[idx].name,
            preferredPayment: entry.preferredPayment,
            updatedAt: now,
          };
          tombstones = clearTombstone(tombstones, result[idx].id);
          updated++;
        }
        continue;
      }
      if (result.length >= opts.limit) {
        skippedFull++;
        continue;
      }
      const fresh: SavedPlayer = { id: legacyIdFor(name), name, updatedAt: now };
      if (entry.preferredPayment) fresh.preferredPayment = entry.preferredPayment;
      result.unshift(fresh);
      tombstones = clearTombstone(tombstones, fresh.id);
      added++;
    }
    await commit(uid, result, tombstones);
    return { added, updated, skippedFull };
  });
}

/**
 * Offline-first load: returns the local (uid-scoped, migrated) list immediately,
 * then background-fetches Firestore, union-merges against the latest local, writes
 * the merged list back to BOTH local and Firestore, and calls onRemoteUpdate(merged).
 * Known offline errors are swallowed to a debug log. Mirrors SyncService.loadGames.
 */
export async function loadSavedPlayers(
  uid: string,
  onRemoteUpdate?: (players: SavedPlayer[]) => void,
  signal?: AbortSignal,
): Promise<SavedPlayer[]> {
  const local = await getSavedPlayers(uid);
  if (uid) {
    (async () => {
      try {
        // Coerce/dedupe remote the same way local reads are: legacy Firestore docs hold
        // id-less entries, and unionMerge keys by id — an uncoerced `undefined` id would
        // sit alongside the coerced-local `legacy:<name>` twin and duplicate the person.
        const remoteDoc = await fetchSavedPlayersFromFirestore(uid);
        const remote = normalize(remoteDoc.players);
        if (signal?.aborted) return;
        const merged = await enqueue(async () => {
          const cur = await readLocal(uid);
          // Merge tombstones from both sides so a delete on either device propagates and
          // is honored here — otherwise a stale remote copy of a just-deleted entry would
          // be resurrected by the union (a union cannot represent a deletion).
          const tombstones = mergeTombstones(await readTombstones(uid), remoteDoc.tombstones);
          // Clamp to PRO_SAVED_CAP so the merged list never exceeds the Firestore
          // security rule's `players.size() <= 200` ceiling (keep in sync with that rule).
          // unionMerge already sorts by updatedAt desc, so this keeps the most-recently-touched names.
          const m = unionMerge(cur, remote, tombstones).slice(0, PRO_SAVED_CAP);
          // Drop tombstones superseded by a live re-add and cap growth before persisting.
          const prunedTombstones = pruneTombstones(tombstones, m);
          await writeLocal(uid, m);
          await writeTombstones(uid, prunedTombstones);
          return { players: m, tombstones: prunedTombstones };
        });
        pushRemote(uid, merged.players, merged.tombstones);
        if (signal?.aborted) return;
        onRemoteUpdate?.(merged.players);
      } catch (err) {
        if (signal?.aborted) return;
        if (isFirestoreOfflineError(err)) {
          console.debug('loadSavedPlayers: skipping background sync — device offline');
          return;
        }
        console.warn('loadSavedPlayers: background sync failed', err);
      }
    })();
  }
  return local;
}
