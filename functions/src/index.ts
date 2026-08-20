import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { deleteSharedGamesForOwner } from './sharedGamesCleanup';

admin.initializeApp();

// ---------------------------------------------------------------------------
// deleteUserData — called by the client when a user deletes their account.
// Performs (in order):
//   1. Cancel the RevenueCat subscription (delete subscriber record)
//   2. Delete the user's /sharedGames documents (top-level; the recursiveDelete
//      below does not reach them)
//   3. Recursively delete all Firestore data under /users/{uid}
//   4. Delete the Firebase Auth user
// ---------------------------------------------------------------------------
// The secret MUST be declared here or firebase-functions v2 never mounts it
// into process.env and cancelRevenueCatSubscriber silently skips (bug-355).
export const deleteUserData = onCall({ secrets: ['REVENUECAT_SECRET_API_KEY'] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }

  const uid = request.auth.uid;

  try {
    // 1. Cancel RevenueCat subscription — delete the subscriber record so the
    //    user is not billed after account deletion (GDPR Article 17 compliance).
    await cancelRevenueCatSubscriber(uid);

    // 2. Delete this user's /sharedGames documents. That collection is TOP
    //    LEVEL, so the recursiveDelete below never reaches it — an account
    //    deletion would otherwise leave player names, amounts and payment
    //    handles readable by anyone holding the URL. Same GDPR Article 17
    //    obligation the RevenueCat cancellation above cites.
    //
    //    BEFORE admin.auth().deleteUser and inside this try, so a failure
    //    surfaces as the HttpsError below rather than silently leaving data
    //    behind after the auth record is already gone.
    const deletedShares = await deleteSharedGamesForOwner(admin.firestore(), uid);
    if (deletedShares > 0) {
      logger.info(`deleteUserData: deleted ${deletedShares} shared game(s) for ${uid}`);
    }

    // 3. Recursively delete Firestore documents under /users/{uid}
    const userDocRef = admin.firestore().doc(`users/${uid}`);
    await admin.firestore().recursiveDelete(userDocRef);

    // 4. Delete the Firebase Auth user
    await admin.auth().deleteUser(uid);
  } catch (error) {
    logger.error(`Failed to fully delete user ${uid}`, error);
    throw new HttpsError('internal', 'Account deletion failed. Please contact support.');
  }

  return { success: true };
});

// ---------------------------------------------------------------------------
// revenuecatWebhook — receives RevenueCat subscription events and updates
// the Firestore user document's tier field.
//
// Security:
//   1. Verifies the Authorization header matches the shared webhook secret
//      configured in the RevenueCat dashboard → Project → Webhooks.
//   2. Double-checks with the RevenueCat REST API before writing tier: "pro"
//      to prevent forged webhook attacks.
//
// Required Firebase secrets (set via Firebase Secret Manager or CLI):
//   REVENUECAT_WEBHOOK_AUTH_KEY   — shared secret from RC dashboard
//   REVENUECAT_SECRET_API_KEY     — V1 secret key for server-to-server calls
// ---------------------------------------------------------------------------
export const revenuecatWebhook = onRequest(
  { secrets: ['REVENUECAT_WEBHOOK_AUTH_KEY', 'REVENUECAT_SECRET_API_KEY'] },
  async (req, res) => {
    // Only accept POST requests
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // 1. Verify Authorization header
    const authHeader = req.headers['authorization'];
    const expectedToken = process.env.REVENUECAT_WEBHOOK_AUTH_KEY;

    if (!expectedToken || !authHeader || authHeader !== expectedToken) {
      logger.warn('revenuecatWebhook: unauthorized request');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const event = req.body?.event;
    if (!event) {
      res.status(400).json({ error: 'Missing event payload' });
      return;
    }

    const appUserId: string | undefined = event.app_user_id;
    if (!appUserId) {
      logger.warn('revenuecatWebhook: missing app_user_id in event');
      res.status(400).json({ error: 'Missing app_user_id' });
      return;
    }

    const eventType: string = event.type ?? '';
    logger.info(`revenuecatWebhook: event=${eventType} uid=${appUserId}`);

    try {
      // 2. Double-check with the RevenueCat REST API (defense in depth)
      const rcSecretKey = process.env.REVENUECAT_SECRET_API_KEY;
      let isProFromRC = false;

      if (rcSecretKey) {
        const rcResponse = await fetch(
          `https://api.revenuecat.com/v1/subscribers/${appUserId}`,
          { headers: { Authorization: `Bearer ${rcSecretKey}` } }
        );

        if (rcResponse.ok) {
          const data = await rcResponse.json() as any;
          isProFromRC = !!(data?.subscriber?.entitlements?.active?.pro);
        } else {
          logger.warn(`revenuecatWebhook: RC API returned ${rcResponse.status} for ${appUserId}`);
        }
      } else {
        // Secret not configured — determine from event type as a fallback
        const proEvents = [
          'INITIAL_PURCHASE',
          'RENEWAL',
          'PRODUCT_CHANGE',
          'BILLING_ISSUE_RESOLVED',
          'UNCANCELLATION',
        ];
        isProFromRC = proEvents.includes(eventType);
      }

      // 3. Write tier to Firestore — only the Cloud Function can do this
      //    (enforced by Firestore security rules that block client tier writes)
      const newTier = isProFromRC ? 'pro' : 'free';
      await admin.firestore().doc(`users/${appUserId}`).update({
        tier: newTier,
        tierUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`revenuecatWebhook: set tier=${newTier} for uid=${appUserId}`);
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error(`revenuecatWebhook: failed to process event for uid=${appUserId}`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Cancel (delete) the RevenueCat subscriber record for the given Firebase UID.
 * This stops future billing after account deletion.
 *
 * NOTE: This deletes the subscriber record. Active App Store / Play Store
 * subscriptions managed by the platform are not forcefully refunded — the user
 * should cancel via the platform if they want a refund for an unused period.
 */
async function cancelRevenueCatSubscriber(uid: string): Promise<void> {
  const rcSecretKey = process.env.REVENUECAT_SECRET_API_KEY;

  if (!rcSecretKey) {
    logger.warn('cancelRevenueCatSubscriber: REVENUECAT_SECRET_API_KEY not configured — skipping RC cancellation');
    return;
  }

  try {
    const response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${uid}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${rcSecretKey}` },
      }
    );

    if (!response.ok && response.status !== 404) {
      // 404 = subscriber not found (user never purchased) — not an error
      logger.warn(`cancelRevenueCatSubscriber: RC returned ${response.status} for uid=${uid}`);
    }
  } catch (error) {
    // Log but do not throw — missing RC cleanup should not block account deletion
    logger.warn(`cancelRevenueCatSubscriber: failed for uid=${uid}`, error);
  }
}
