import AsyncStorage from '@react-native-async-storage/async-storage';

// Stub the Firestore layer so the service's fire-and-forget remote writes and
// background fetch never touch a real Firebase instance.
jest.mock('@/services/firebaseService', () => ({
  saveSavedPlayersToFirestore: jest.fn(() => Promise.resolve()),
  fetchSavedPlayersFromFirestore: jest.fn(() => Promise.resolve({ players: [], tombstones: {} })),
  isFirestoreOfflineError: jest.fn(() => false),
}));

/** Wrap a players array (and optional tombstones) as the Firestore saved-players doc. */
const remoteDoc = (players: SavedPlayer[], tombstones: Record<string, number> = {}) => ({
  players,
  tombstones,
});

import {
  getSavedPlayers,
  getSavedPlayerNames,
  getSavedPlayer,
  getSavedPlayerById,
  getSavedPlayersByName,
  createSavedPlayer,
  updateSavedPlayer,
  deleteSavedPlayerById,
  deleteSavedPlayersByIds,
  savePlayer,
  deleteSavedPlayer,
  deleteSavedPlayers,
  addSavedPlayers,
  loadSavedPlayers,
  unionMerge,
  renameSavedPlayer,
  SavedPlayer,
  FREE_SAVED_CAP,
  PRO_SAVED_CAP,
  savedCapFor,
  canAddMoreSavedPlayers,
  legacyIdFor,
  newSavedPlayerId,
} from '@/services/savedPlayersService';
import { fetchSavedPlayersFromFirestore, saveSavedPlayersToFirestore } from '@/services/firebaseService';
import { resolvePayment } from '@/utils/paymentMethods';

const LEGACY_KEY = 'saved_player_names';
const A = 'userA';
const B = 'userB';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  (fetchSavedPlayersFromFirestore as jest.Mock).mockResolvedValue(remoteDoc([]));
});

describe('account isolation (the bug)', () => {
  it('does not leak saved players from one account to another', async () => {
    await savePlayer(A, 'Alice');
    expect(await getSavedPlayerNames(B)).toEqual([]);
    expect(await getSavedPlayerNames(A)).toEqual(['Alice']);
  });
});

describe('manager-screen add gating (cap-based, not tier-based)', () => {
  it('resolves the free cap for non-pro and the pro cap for pro', () => {
    expect(savedCapFor(false)).toBe(FREE_SAVED_CAP);
    expect(savedCapFor(true)).toBe(PRO_SAVED_CAP);
  });

  it('lets a free user add while under the cap — even with zero saved players', () => {
    expect(canAddMoreSavedPlayers(0, false)).toBe(true);
    expect(canAddMoreSavedPlayers(FREE_SAVED_CAP - 1, false)).toBe(true);
  });

  it('blocks a free user at or over the cap', () => {
    expect(canAddMoreSavedPlayers(FREE_SAVED_CAP, false)).toBe(false);
    expect(canAddMoreSavedPlayers(FREE_SAVED_CAP + 5, false)).toBe(false);
  });

  it('bounds a pro user only by the pro cap', () => {
    expect(canAddMoreSavedPlayers(FREE_SAVED_CAP, true)).toBe(true);
    expect(canAddMoreSavedPlayers(PRO_SAVED_CAP - 1, true)).toBe(true);
    expect(canAddMoreSavedPlayers(PRO_SAVED_CAP, true)).toBe(false);
  });
});

describe('legacy-key migration', () => {
  it('adopts the legacy global key into the first uid and removes the legacy key', async () => {
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(['Alice', 'Bob']));
    const names = await getSavedPlayerNames(A);
    expect(names.sort()).toEqual(['Alice', 'Bob']);
    expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('a second account does not inherit the already-adopted legacy pool', async () => {
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(['Alice']));
    await getSavedPlayerNames(A); // A adopts + clears legacy
    expect(await getSavedPlayerNames(B)).toEqual([]);
  });

  it('does not overwrite an existing uid-scoped list with legacy data', async () => {
    await savePlayer(A, 'Zed');
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(['Alice']));
    expect(await getSavedPlayerNames(A)).toEqual(['Zed']);
  });
});

describe('coercion of stored entries', () => {
  it('reads a legacy string[] under a uid key as SavedPlayer[]', async () => {
    await AsyncStorage.setItem(`saved_player_names:${A}`, JSON.stringify(['Alice', 'Bob']));
    expect(await getSavedPlayers(A)).toEqual([
      { id: 'legacy:alice', name: 'Alice' },
      { id: 'legacy:bob', name: 'Bob' },
    ]);
  });

  it('reads a mixed array (legacy string + new object)', async () => {
    await AsyncStorage.setItem(
      `saved_player_names:${A}`,
      JSON.stringify(['Alice', { name: 'Bob', preferredPayment: { method: 'venmo', handle: '@bob' } }]),
    );
    const players = await getSavedPlayers(A);
    expect(players[0]).toEqual({ id: 'legacy:alice', name: 'Alice' });
    expect(resolvePayment(players[1])?.handle).toBe('@bob');
  });
});

describe('id: deterministic migration + generation', () => {
  it('legacyIdFor is deterministic and case-insensitive', () => {
    expect(legacyIdFor('Mike')).toBe('legacy:mike');
    expect(legacyIdFor('  MIKE  ')).toBe('legacy:mike');
  });

  it('newSavedPlayerId is unique and sp-prefixed', () => {
    const a = newSavedPlayerId();
    const b = newSavedPlayerId();
    expect(a).toMatch(/^sp_/);
    expect(a).not.toBe(b);
  });

  it('coerces a legacy string to an entry with a deterministic id', async () => {
    await AsyncStorage.setItem(`saved_player_names:${A}`, JSON.stringify(['Alice']));
    const [p] = await getSavedPlayers(A);
    expect(p).toEqual({ id: 'legacy:alice', name: 'Alice' });
  });

  it('two independent migrations of the same legacy list converge on the same ids', async () => {
    await AsyncStorage.setItem(`saved_player_names:${A}`, JSON.stringify(['Alice', 'Bob']));
    await AsyncStorage.setItem(`saved_player_names:${B}`, JSON.stringify(['Bob', 'Alice']));
    const idsA = (await getSavedPlayers(A)).map(p => p.id).sort();
    const idsB = (await getSavedPlayers(B)).map(p => p.id).sort();
    expect(idsA).toEqual(idsB);
    expect(idsA).toEqual(['legacy:alice', 'legacy:bob']);
  });

  it('preserves an already-present id (does not re-mint)', async () => {
    await AsyncStorage.setItem(
      `saved_player_names:${A}`,
      JSON.stringify([{ id: 'sp_kept', name: 'Alice' }]),
    );
    expect((await getSavedPlayers(A))[0].id).toBe('sp_kept');
  });
});

describe('unionMerge keyed by id', () => {
  it('keeps two same-name entries with different ids', () => {
    const merged = unionMerge(
      [{ id: 'sp_1', name: 'Mike', updatedAt: 1 }],
      [{ id: 'sp_2', name: 'Mike', updatedAt: 2 }],
    );
    expect(merged.map(p => p.id).sort()).toEqual(['sp_1', 'sp_2']);
  });

  it('dedups same-id entries by greater updatedAt', () => {
    const merged = unionMerge(
      [{ id: 'sp_1', name: 'Mike', preferredPayment: { method: 'venmo', handle: 'old' }, updatedAt: 1 }],
      [{ id: 'sp_1', name: 'Mike', preferredPayment: { method: 'cashapp', handle: 'new' }, updatedAt: 9 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].preferredPayment).toEqual({ method: 'cashapp', handle: 'new' });
  });
});

describe('savePlayer / getSavedPlayer', () => {
  it('persists a payment and finds it case-insensitively', async () => {
    await savePlayer(A, 'Alice', { methods: { venmo: '@alice' }, defaultMethod: 'venmo' });
    const found = await getSavedPlayer(A, 'alice');
    expect(resolvePayment(found)).toEqual({ method: 'venmo', handle: '@alice' });
  });

  it('without a payment preserves an existing one', async () => {
    await savePlayer(A, 'Alice', { methods: { venmo: '@alice' }, defaultMethod: 'venmo' });
    await savePlayer(A, 'Alice');
    expect(resolvePayment(await getSavedPlayer(A, 'Alice'))?.handle).toBe('@alice');
  });

  it('stamps updatedAt on save', async () => {
    await savePlayer(A, 'Alice');
    expect(typeof (await getSavedPlayer(A, 'Alice'))?.updatedAt).toBe('number');
  });
});

describe('delete', () => {
  it('removes an entry case-insensitively', async () => {
    await savePlayer(A, 'Alice');
    await savePlayer(A, 'Bob');
    await deleteSavedPlayer(A, 'ALICE');
    expect((await getSavedPlayerNames(A)).sort()).toEqual(['Bob']);
  });

  it('removes multiple entries', async () => {
    await savePlayer(A, 'Alice');
    await savePlayer(A, 'Bob');
    await savePlayer(A, 'Cara');
    await deleteSavedPlayers(A, ['alice', 'cara']);
    expect(await getSavedPlayerNames(A)).toEqual(['Bob']);
  });
});

describe('addSavedPlayers', () => {
  it('adds new entries and merges duplicates (updating payment)', async () => {
    await savePlayer(A, 'Alice', { methods: { venmo: 'alice' }, defaultMethod: 'venmo' });
    const res = await addSavedPlayers(
      A,
      [
        { name: 'Bob' },
        { name: 'alice', preferredPayment: { method: 'cashapp', handle: 'aliceC' } },
      ],
      { limit: PRO_SAVED_CAP },
    );
    expect(res).toEqual({ added: 1, updated: 1, skippedFull: 0 });
    expect(resolvePayment(await getSavedPlayer(A, 'Alice'))).toEqual({
      method: 'cashapp',
      handle: 'aliceC',
    });
    expect(await getSavedPlayer(A, 'Bob')).toBeDefined();
  });

  it('respects the limit for new entries and reports skippedFull', async () => {
    await addSavedPlayers(A, [{ name: 'A' }, { name: 'B' }], { limit: 2 });
    const res = await addSavedPlayers(A, [{ name: 'C' }, { name: 'D' }], { limit: 2 });
    expect(res).toEqual({ added: 0, updated: 0, skippedFull: 2 });
    expect((await getSavedPlayers(A)).length).toBe(2);
  });
});

describe('cap semantics', () => {
  it('savePlayer does not add a new entry when at the limit', async () => {
    await addSavedPlayers(A, [{ name: 'A' }, { name: 'B' }], { limit: 2 });
    await savePlayer(A, 'C', undefined, 2);
    expect(await getSavedPlayerNames(A)).not.toContain('C');
    expect((await getSavedPlayers(A)).length).toBe(2);
  });

  it('savePlayer updates an existing entry even at/over the limit', async () => {
    await addSavedPlayers(A, [{ name: 'A' }, { name: 'B' }], { limit: 2 });
    await savePlayer(A, 'A', { methods: { venmo: 'a' }, defaultMethod: 'venmo' }, 2);
    expect(resolvePayment(await getSavedPlayer(A, 'A'))).toEqual({ method: 'venmo', handle: 'a' });
  });

  it('never truncates existing entries above the limit', async () => {
    await addSavedPlayers(A, [{ name: 'A' }, { name: 'B' }, { name: 'C' }], { limit: PRO_SAVED_CAP });
    await savePlayer(A, 'A', { methods: { venmo: 'a' }, defaultMethod: 'venmo' }, 2);
    expect((await getSavedPlayers(A)).length).toBe(3);
  });

  it('exports the tier caps', () => {
    expect(FREE_SAVED_CAP).toBe(15);
    expect(PRO_SAVED_CAP).toBe(200);
  });
});

describe('savePlayer updateOnly (in-game payment editor path)', () => {
  it('updates an existing entry\'s payment', async () => {
    await savePlayer(A, 'Alice');
    await savePlayer(A, 'Alice', { methods: { venmo: '@alice' }, defaultMethod: 'venmo' }, PRO_SAVED_CAP, { updateOnly: true });
    expect(resolvePayment(await getSavedPlayer(A, 'Alice'))?.handle).toBe('@alice');
  });

  it('never creates a new entry, even under the cap', async () => {
    await savePlayer(A, 'Ghost', { methods: { venmo: '@g' }, defaultMethod: 'venmo' }, PRO_SAVED_CAP, { updateOnly: true });
    expect(await getSavedPlayer(A, 'Ghost')).toBeUndefined();
    expect(await getSavedPlayers(A)).toEqual([]);
  });

  it('still updates an existing entry when the list is at the limit', async () => {
    await addSavedPlayers(A, [{ name: 'A' }, { name: 'B' }], { limit: 2 });
    await savePlayer(A, 'A', { methods: { cashapp: 'a' }, defaultMethod: 'cashapp' }, 2, { updateOnly: true });
    expect(resolvePayment(await getSavedPlayer(A, 'A'))).toEqual({ method: 'cashapp', handle: 'a' });
    expect((await getSavedPlayers(A)).length).toBe(2);
  });
});

describe('concurrency', () => {
  it('serializes concurrent writes without dropping one', async () => {
    await Promise.all([
      addSavedPlayers(A, [{ name: 'A' }], { limit: 200 }),
      addSavedPlayers(A, [{ name: 'B' }], { limit: 200 }),
    ]);
    expect((await getSavedPlayers(A)).length).toBe(2);
  });
});

describe('loadSavedPlayers', () => {
  it('returns local immediately and delivers the union-merged remote via onRemoteUpdate', async () => {
    await savePlayer(A, 'Alice');
    await savePlayer(A, 'Bob');
    (fetchSavedPlayersFromFirestore as jest.Mock).mockResolvedValueOnce(
      remoteDoc([
        { id: 'legacy:alice', name: 'Alice', updatedAt: 1 },
        { id: 'sp_carol', name: 'Carol', updatedAt: 2 },
      ]),
    );
    const merged = await new Promise<SavedPlayer[]>((resolve, reject) => {
      loadSavedPlayers(A, resolve).catch(reject);
    });
    expect(merged.map(p => p.name).sort()).toEqual(['Alice', 'Bob', 'Carol']);
    // merged result was written back to local
    expect((await getSavedPlayerNames(A)).sort()).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('clamps a union exceeding PRO_SAVED_CAP to 200, keeping the most-recently-touched names', async () => {
    // Seed 200 distinct local names with ascending updatedAt (Local1 oldest ... Local200 newest-of-locals).
    const localEntries: SavedPlayer[] = Array.from({ length: PRO_SAVED_CAP }, (_, i) => ({
      id: `sp_local_${i + 1}`,
      name: `Local${i + 1}`,
      updatedAt: i + 1,
    }));
    await AsyncStorage.setItem(`saved_player_names:${A}`, JSON.stringify(localEntries));

    // Remote contributes 10 more distinct names, all newer than every local entry.
    const remoteEntries: SavedPlayer[] = Array.from({ length: 10 }, (_, i) => ({
      id: `sp_remote_${i + 1}`,
      name: `Remote${i + 1}`,
      updatedAt: 100000 + i,
    }));
    (fetchSavedPlayersFromFirestore as jest.Mock).mockResolvedValueOnce(remoteDoc(remoteEntries));

    const merged = await new Promise<SavedPlayer[]>((resolve, reject) => {
      loadSavedPlayers(A, resolve).catch(reject);
    });

    // Union would otherwise be 210 (200 local + 10 remote, no overlaps) — must clamp to the cap.
    expect(merged.length).toBe(PRO_SAVED_CAP);
    // The newest remote name survived the clamp.
    expect(merged.some(p => p.name === 'Remote10')).toBe(true);
    // The oldest local name (lowest updatedAt) was dropped by the clamp.
    expect(merged.some(p => p.name === 'Local1')).toBe(false);
  });
});

describe('duplicate-name regression (id-less remote / corrupted local)', () => {
  it('does not duplicate a name when the remote copy is a legacy id-less entry', async () => {
    await savePlayer(A, 'Alice'); // local: { id: 'legacy:alice', name: 'Alice' }
    // Firestore holds a pre-refactor, id-less copy of the SAME person. Without coercing
    // the remote list, unionMerge keys it under `undefined` and keeps it alongside the
    // coerced-local 'legacy:alice' — two rows named 'Alice'.
    (fetchSavedPlayersFromFirestore as jest.Mock).mockResolvedValueOnce(
      remoteDoc([{ name: 'Alice', updatedAt: 1 } as SavedPlayer]),
    );
    const merged = await new Promise<SavedPlayer[]>((resolve, reject) => {
      loadSavedPlayers(A, resolve).catch(reject);
    });
    expect(merged.filter(p => p.name === 'Alice')).toHaveLength(1);
    expect(merged[0].id).toBe('legacy:alice');
  });

  it('heals an already-corrupted local list (two entries coercing to the same id)', async () => {
    // Storage left doubled by the pre-fix merge: two id-less 'Alice' copies that both
    // coerce to id 'legacy:alice'. The read path must dedupe them (keeping the newest).
    await AsyncStorage.setItem(
      `saved_player_names:${A}`,
      JSON.stringify([
        { name: 'Alice', updatedAt: 1 },
        { name: 'Alice', updatedAt: 2 },
      ]),
    );
    const players = await getSavedPlayers(A);
    expect(players).toHaveLength(1);
    expect(players[0].id).toBe('legacy:alice');
    expect(players[0].updatedAt).toBe(2);
  });

  it('plain add (deterministic id) reconciles with a remote-only same-name entry', async () => {
    // The screen's plain "Add" routes through savePlayer, whose deterministic legacy:<name>
    // id matches a same-name copy that exists only in Firestore (other device / pre-sync) —
    // so the two collapse to one on merge. (createSavedPlayer's random id would NOT: that is
    // reserved for the explicit "Add separate person" path.)
    await savePlayer(A, 'Alice'); // deterministic legacy:alice, local-only
    (fetchSavedPlayersFromFirestore as jest.Mock).mockResolvedValueOnce(
      remoteDoc([{ name: 'Alice', updatedAt: 1 } as SavedPlayer]),
    );
    const merged = await new Promise<SavedPlayer[]>((resolve, reject) => {
      loadSavedPlayers(A, resolve).catch(reject);
    });
    expect(merged.filter(p => p.name === 'Alice')).toHaveLength(1);
    expect(merged[0].id).toBe('legacy:alice');
  });
});

describe('id-addressed CRUD', () => {
  it('createSavedPlayer returns a new id and stores the entry', async () => {
    const res = await createSavedPlayer(A, 'Mike', { methods: { venmo: 'm' }, defaultMethod: 'venmo' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = await getSavedPlayerById(A, res.id);
    expect(p?.name).toBe('Mike');
    expect(resolvePayment(p)).toEqual({ method: 'venmo', handle: 'm' });
  });

  it('createSavedPlayer refuses a second saved player with the same name (case-insensitive)', async () => {
    const a = await createSavedPlayer(A, 'Mike', { methods: { venmo: 'v' }, defaultMethod: 'venmo' });
    expect(a.ok).toBe(true);
    const b = await createSavedPlayer(A, 'mike', { methods: { cashapp: 'c' }, defaultMethod: 'cashapp' });
    expect(b).toEqual({ ok: false, reason: 'duplicate' });
    expect((await getSavedPlayersByName(A, 'mike')).length).toBe(1);
  });

  it('reports duplicate (not full) when a same-name entry already exists at the cap', async () => {
    // limit 1: after this the list is at the cap AND holds 'Mike'.
    const a = await createSavedPlayer(A, 'Mike', undefined, 1);
    expect(a.ok).toBe(true);
    // Both conditions true (at cap + duplicate name). The duplicate guard must win → 'duplicate', not 'full'.
    const b = await createSavedPlayer(A, 'mike', undefined, 1);
    expect(b).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('createSavedPlayer refuses an empty name and reports full at the cap', async () => {
    expect(await createSavedPlayer(A, '   ')).toEqual({ ok: false, reason: 'empty' });
    await createSavedPlayer(A, 'X', undefined, 1);
    expect(await createSavedPlayer(A, 'Y', undefined, 1)).toEqual({ ok: false, reason: 'full' });
  });

  it('updateSavedPlayer patches name and payment by id, bumping updatedAt', async () => {
    const res = await createSavedPlayer(A, 'Mike');
    if (!res.ok) throw new Error('setup');
    const ok = await updateSavedPlayer(A, res.id, { name: 'Michael', methods: { venmo: 'm' }, defaultMethod: 'venmo' });
    expect(ok).toBe(true);
    const p = await getSavedPlayerById(A, res.id);
    expect(p?.name).toBe('Michael');
    expect(resolvePayment(p)).toEqual({ method: 'venmo', handle: 'm' });
    expect(typeof p?.updatedAt).toBe('number');
  });

  it('updateSavedPlayer returns false for an unknown id and touches nothing', async () => {
    await createSavedPlayer(A, 'Mike');
    expect(await updateSavedPlayer(A, 'sp_missing', { name: 'X' })).toBe(false);
    expect((await getSavedPlayers(A)).length).toBe(1);
  });

  it('updateSavedPlayer rejects a name already used by a different entry', async () => {
    const a = await createSavedPlayer(A, 'Alice');
    const b = await createSavedPlayer(A, 'Bob');
    if (!a.ok || !b.ok) throw new Error('setup');
    expect(await updateSavedPlayer(A, b.id, { name: 'alice' })).toBe(false);
    expect((await getSavedPlayerById(A, b.id))?.name).toBe('Bob');
  });

  it('updateSavedPlayer allows a case-only self-rename', async () => {
    const a = await createSavedPlayer(A, 'alice');
    if (!a.ok) throw new Error('setup');
    expect(await updateSavedPlayer(A, a.id, { name: 'Alice' })).toBe(true);
    expect((await getSavedPlayerById(A, a.id))?.name).toBe('Alice');
  });

  it('deletes by id, leaving a same-name twin intact', async () => {
    // Legacy / cross-device data can hold two same-name entries with distinct ids; seed directly.
    await AsyncStorage.setItem(
      `saved_player_names:${A}`,
      JSON.stringify([
        { id: 'sp_a', name: 'Mike', preferredPayment: { method: 'venmo', handle: 'v' }, updatedAt: 1 },
        { id: 'sp_b', name: 'Mike', preferredPayment: { method: 'cashapp', handle: 'c' }, updatedAt: 2 },
      ]),
    );
    await deleteSavedPlayerById(A, 'sp_a');
    const left = await getSavedPlayersByName(A, 'Mike');
    expect(left.map(p => p.id)).toEqual(['sp_b']);
  });

  it('deletes several by id', async () => {
    const a = await createSavedPlayer(A, 'A');
    const b = await createSavedPlayer(A, 'B');
    const c = await createSavedPlayer(A, 'C');
    if (!a.ok || !b.ok || !c.ok) throw new Error('setup');
    await deleteSavedPlayersByIds(A, [a.id, c.id]);
    expect((await getSavedPlayers(A)).map(p => p.name)).toEqual(['B']);
  });
});

describe('delete resurrection (tombstones)', () => {
  it('a deleted player is not resurrected by a stale remote fetch', async () => {
    const res = await createSavedPlayer(A, 'Alice');
    if (!res.ok) throw new Error('setup');
    const id = res.id;

    // The race: the delete's remote push has not propagated, so the background
    // fetch still returns the pre-delete list (Alice present, no tombstone).
    (fetchSavedPlayersFromFirestore as jest.Mock).mockResolvedValueOnce(
      remoteDoc([{ id, name: 'Alice', updatedAt: 1 }]),
    );

    await deleteSavedPlayerById(A, id);
    expect(await getSavedPlayerNames(A)).toEqual([]); // gone locally after delete

    const merged = await new Promise<SavedPlayer[]>((resolve, reject) => {
      loadSavedPlayers(A, resolve).catch(reject);
    });
    // The local tombstone drops the stale remote copy — Alice stays gone.
    expect(merged.some(p => p.name === 'Alice')).toBe(false);
    expect(await getSavedPlayerNames(A)).toEqual([]);
  });

  it('a remote tombstone deletes an entry that still exists locally (cross-device delete)', async () => {
    // This device still has Alice; another device deleted her and the delete arrives
    // as a remote tombstone newer than Alice's updatedAt.
    await AsyncStorage.setItem(
      `saved_player_names:${A}`,
      JSON.stringify([{ id: 'sp_alice', name: 'Alice', updatedAt: 5 }]),
    );
    (fetchSavedPlayersFromFirestore as jest.Mock).mockResolvedValueOnce(
      remoteDoc([], { sp_alice: 10 }),
    );
    const merged = await new Promise<SavedPlayer[]>((resolve, reject) => {
      loadSavedPlayers(A, resolve).catch(reject);
    });
    expect(merged.some(p => p.id === 'sp_alice')).toBe(false);
    expect(await getSavedPlayerNames(A)).toEqual([]);
  });

  it('a re-add after delete survives (the newer add supersedes the tombstone)', async () => {
    await savePlayer(A, 'Alice'); // id legacy:alice
    await deleteSavedPlayer(A, 'Alice'); // tombstone legacy:alice
    expect(await getSavedPlayerNames(A)).toEqual([]);

    await savePlayer(A, 'Alice'); // re-add, newer updatedAt clears the tombstone
    expect(await getSavedPlayerNames(A)).toEqual(['Alice']);

    // A stale remote fetch (Alice absent) must NOT delete the fresh re-add.
    (fetchSavedPlayersFromFirestore as jest.Mock).mockResolvedValueOnce(remoteDoc([]));
    const merged = await new Promise<SavedPlayer[]>((resolve, reject) => {
      loadSavedPlayers(A, resolve).catch(reject);
    });
    expect(merged.some(p => p.name === 'Alice')).toBe(true);
  });

  it('the delete is pushed to Firestore with a tombstone for the removed id', async () => {
    const res = await createSavedPlayer(A, 'Alice');
    if (!res.ok) throw new Error('setup');
    (saveSavedPlayersToFirestore as jest.Mock).mockClear();
    await deleteSavedPlayerById(A, res.id);
    const [, players, tombstones] = (saveSavedPlayersToFirestore as jest.Mock).mock.calls.at(-1)!;
    expect(players).toEqual([]);
    expect(tombstones[res.id]).toEqual(expect.any(Number));
  });

  it('prunes a tombstone once a live re-add supersedes it', async () => {
    await AsyncStorage.setItem(
      `saved_player_names:${A}`,
      JSON.stringify([{ id: 'sp_alice', name: 'Alice', updatedAt: 20 }]),
    );
    // Remote carries an OLD tombstone for the same id (delete predates the current entry).
    (fetchSavedPlayersFromFirestore as jest.Mock).mockResolvedValueOnce(
      remoteDoc([{ id: 'sp_alice', name: 'Alice', updatedAt: 20 }], { sp_alice: 10 }),
    );
    (saveSavedPlayersToFirestore as jest.Mock).mockClear();
    await new Promise<SavedPlayer[]>((resolve, reject) => {
      loadSavedPlayers(A, resolve).catch(reject);
    });
    const [, players, tombstones] = (saveSavedPlayersToFirestore as jest.Mock).mock.calls.at(-1)!;
    expect(players.map((p: SavedPlayer) => p.name)).toEqual(['Alice']);
    expect(tombstones).toEqual({}); // superseded tombstone pruned
  });
});

describe('renameSavedPlayer (id-based)', () => {
  it('renames by id, preserving id + payment and bumping updatedAt', async () => {
    const res = await createSavedPlayer(A, 'Bob', { methods: { venmo: '@bob' }, defaultMethod: 'venmo' });
    if (!res.ok) throw new Error('setup');
    const before = (await getSavedPlayerById(A, res.id))!.updatedAt!;
    expect(await renameSavedPlayer(A, res.id, 'Bobby')).toEqual({ ok: true });
    const p = await getSavedPlayerById(A, res.id);
    expect(p?.name).toBe('Bobby');
    expect(resolvePayment(p)).toEqual({ method: 'venmo', handle: '@bob' });
    expect(p?.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('rejects renaming to a name another saved player already uses', async () => {
    await createSavedPlayer(A, 'Jordan');
    const bob = await createSavedPlayer(A, 'Bob');
    if (!bob.ok) throw new Error('setup');
    expect(await renameSavedPlayer(A, bob.id, 'jordan')).toEqual({ ok: false, reason: 'duplicate' });
    expect((await getSavedPlayersByName(A, 'Jordan')).length).toBe(1);
    expect((await getSavedPlayerById(A, bob.id))?.name).toBe('Bob');
  });

  it('allows a case-only self-rename', async () => {
    const bob = await createSavedPlayer(A, 'bob');
    if (!bob.ok) throw new Error('setup');
    expect(await renameSavedPlayer(A, bob.id, 'Bob')).toEqual({ ok: true });
    expect((await getSavedPlayerById(A, bob.id))?.name).toBe('Bob');
  });

  it('returns the right reason for an empty new name or an unknown id', async () => {
    const res = await createSavedPlayer(A, 'Bob');
    if (!res.ok) throw new Error('setup');
    expect(await renameSavedPlayer(A, res.id, '   ')).toEqual({ ok: false, reason: 'empty' });
    expect(await renameSavedPlayer(A, 'sp_missing', 'X')).toEqual({ ok: false, reason: 'notfound' });
  });
});

describe('D1 grandfather: a downgrade never removes saved players', () => {
  it('keeps all 40 entries readable while blocking new adds', async () => {
    const names = Array.from({ length: 40 }, (_, i) => ({ name: `P${i}` }));
    await addSavedPlayers(A, names, { limit: PRO_SAVED_CAP });

    // The tier flips to free. Nothing is trimmed.
    expect(canAddMoreSavedPlayers(40, false)).toBe(false);

    const after = await getSavedPlayers(A);
    expect(after).toHaveLength(40);
  });

  it('survives a save/load round-trip while over the free cap', async () => {
    const names = Array.from({ length: 40 }, (_, i) => ({ name: `P${i}` }));
    await addSavedPlayers(A, names, { limit: PRO_SAVED_CAP });

    // A write performed while over the free cap must not truncate to it.
    await savePlayer(A, 'P0', undefined, FREE_SAVED_CAP);

    const after = await getSavedPlayers(A);
    expect(after).toHaveLength(40);
  });
});

describe('payment carrier persistence (Task 3)', () => {
  it('round-trips methods and defaultMethod on a saved player', async () => {
    const res = await createSavedPlayer(A, 'Mike', { methods: { venmo: 'm', zelle: 'm@x' }, defaultMethod: 'zelle' });
    expect(res.ok).toBe(true);
    const p = await getSavedPlayer(A, 'Mike');
    expect(p?.methods).toEqual({ venmo: 'm', zelle: 'm@x' });
    expect(p?.defaultMethod).toBe('zelle');
  });

  it('synthesizes methods when only a legacy preferredPayment was stored', async () => {
    await AsyncStorage.setItem(
      `saved_player_names:${A}`,
      JSON.stringify([{ id: 'sp_1', name: 'Bob', preferredPayment: { method: 'venmo', handle: '@bob' }, updatedAt: 1 }]),
    );
    const p = await getSavedPlayer(A, 'Bob');
    expect(p?.methods).toEqual({ venmo: '@bob' });
    expect(p?.defaultMethod).toBe('venmo');
  });

  it('replaces the whole map on a same-id merge, newest updatedAt wins', () => {
    const merged = unionMerge(
      [{ id: 'sp_1', name: 'Mike', methods: { venmo: 'old', zelle: 'z' }, defaultMethod: 'venmo', updatedAt: 1 }],
      [{ id: 'sp_1', name: 'Mike', methods: { cashapp: 'new' }, defaultMethod: 'cashapp', updatedAt: 9 }],
    );
    // Deliberately NOT a per-key union: a per-key merge cannot tell "never had it" from
    // "deleted it", and resurrects deleted handles. See spec §4.
    expect(merged[0].methods).toEqual({ cashapp: 'new' });
    expect(merged[0].defaultMethod).toBe('cashapp');
  });

  it('updateSavedPlayer replaces the map wholesale', async () => {
    const res = await createSavedPlayer(A, 'Mike', { methods: { venmo: 'm', zelle: 'z' }, defaultMethod: 'venmo' });
    const id = (res as { ok: true; id: string }).id;
    await updateSavedPlayer(A, id, { methods: { cashapp: 'c' }, defaultMethod: 'cashapp' });
    const p = await getSavedPlayer(A, 'Mike');
    expect(p?.methods).toEqual({ cashapp: 'c' });
    expect(p?.defaultMethod).toBe('cashapp');
  });

  it('a recency-bump patch with no payment keys leaves the map untouched', async () => {
    const res = await createSavedPlayer(A, 'Mike', { methods: { venmo: 'm' }, defaultMethod: 'venmo' });
    const id = (res as { ok: true; id: string }).id;
    await updateSavedPlayer(A, id, {});
    const p = await getSavedPlayer(A, 'Mike');
    expect(p?.methods).toEqual({ venmo: 'm' });
  });

  it('stores a derived legacy preferredPayment for a 2.0.2 reader', async () => {
    await createSavedPlayer(A, 'Mike', { methods: { venmo: 'm', zelle: 'z' }, defaultMethod: 'zelle' });
    const raw = JSON.parse((await AsyncStorage.getItem(`saved_player_names:${A}`)) as string);
    expect(raw[0].preferredPayment).toEqual({ method: 'zelle', handle: 'z' });
  });

  // R-4: derivation must happen at every serialize boundary, not inside the write functions.
  // readLocal's legacy-key migration, writeLocal itself, and pushRemote are three separate
  // JSON.stringify/Firestore-write points; a sync-merge round trip exercises the
  // readLocal -> parseList -> coerce -> unionMerge -> writeLocal path (savedPlayersService.ts:535-539),
  // which is NOT one of the three functions that build the entry (createSavedPlayer/
  // updateSavedPlayer/savePlayer). The fixture supplies methods/defaultMethod and NO
  // preferredPayment, so derivation must actually run to produce one — a fixture that
  // supplied preferredPayment instead would pass even with the derivation deleted.
  it('a sync-merge round trip still leaves a derived preferredPayment in the raw store', async () => {
    await AsyncStorage.setItem(
      `saved_player_names:${A}`,
      JSON.stringify([{ id: 'sp_1', name: 'Mike', methods: { venmo: 'm' }, defaultMethod: 'venmo', updatedAt: 1 }]),
    );
    await new Promise<SavedPlayer[]>((resolve, reject) => {
      loadSavedPlayers(A, resolve).catch(reject);
    });
    const raw = JSON.parse((await AsyncStorage.getItem(`saved_player_names:${A}`)) as string);
    expect(raw.find((p: SavedPlayer) => p.id === 'sp_1').preferredPayment).toEqual({
      method: 'venmo',
      handle: 'm',
    });
    // Same coverage for the Firestore push (pushRemote, savedPlayersService.ts:199) — a
    // separate serialize point from writeLocal above. loadSavedPlayers fires pushRemote
    // synchronously before resolving onRemoteUpdate (see loadSavedPlayers), so the mock's
    // last call is already populated by the time the awaited promise above settles.
    const pushedPlayers = (saveSavedPlayersToFirestore as jest.Mock).mock.calls.at(-1)![1];
    expect(pushedPlayers.find((p: SavedPlayer) => p.id === 'sp_1').preferredPayment).toEqual({
      method: 'venmo',
      handle: 'm',
    });
  });

  // R-4: the legacy-key migration write (readLocal, savedPlayersService.ts:151) is a THIRD
  // distinct serialize point from writeLocal/pushRemote above — it used to be a direct
  // AsyncStorage.setItem, now routed through writeLocal. None of the pre-existing
  // legacy-migration tests carry a payment, so none of them would notice this line
  // regressing back to a bare setItem. Fixture supplies methods/defaultMethod and NO
  // preferredPayment so derivation must actually run.
  it('derives a preferredPayment for a 2.0.2 reader when migrating a legacy-key entry that has methods', async () => {
    await AsyncStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([{ id: 'sp_1', name: 'Mike', methods: { venmo: 'm' }, defaultMethod: 'venmo' }]),
    );
    await getSavedPlayerNames(A); // triggers the one-time legacy-key migration
    const raw = JSON.parse((await AsyncStorage.getItem(`saved_player_names:${A}`)) as string);
    expect(raw.find((p: SavedPlayer) => p.id === 'sp_1').preferredPayment).toEqual({
      method: 'venmo',
      handle: 'm',
    });
  });
});
