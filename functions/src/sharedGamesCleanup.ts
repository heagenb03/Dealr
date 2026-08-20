import type { firestore } from 'firebase-admin';

/**
 * Delete every /sharedGames document owned by `uid`, returning how many went.
 *
 * /sharedGames is a TOP-LEVEL collection, so deleteUserData's
 * recursiveDelete(doc('users/{uid}')) never reaches it. Without this, deleting
 * an account leaves every share document that account created — player names,
 * amounts and payment handles — intact and readable by anyone holding the URL.
 *
 * The Admin SDK bypasses security rules, so this query works despite
 * `allow list: if false`; that rule stays untouched, and the no-enumeration
 * guarantee for CLIENTS is unaffected.
 *
 * `ownerUid` equality is a single-field query, covered by Firestore's automatic
 * single-field indexes. No composite index, no firestore.indexes.json change.
 *
 * Imports firebase-admin for TYPES ONLY, so the compiled module has no runtime
 * imports and the emulator test can require it without booting
 * firebase-functions (index.ts calls initializeApp at module scope).
 */

/** Below Firestore's 500-writes-per-batch limit, with headroom. */
const BATCH_SIZE = 400;

export async function deleteSharedGamesForOwner(
  db: firestore.Firestore,
  uid: string,
): Promise<number> {
  const snap = await db.collection('sharedGames').where('ownerUid', '==', uid).get();
  if (snap.empty) return 0;

  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + BATCH_SIZE)) {
      batch.delete(d.ref);
    }
    await batch.commit();
  }
  return docs.length;
}
