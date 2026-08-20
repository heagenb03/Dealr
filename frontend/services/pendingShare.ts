/**
 * One shareId, held across the sign-in gate.
 *
 * DELIBERATELY NOT A REACT CONTEXT. Two hard requirements rule that out:
 *
 *  1. It must be writable BEFORE the provider tree mounts — a deep link can
 *     arrive during cold start.
 *  2. It must be readable SYNCHRONOUSLY. The only consumer that matters is the
 *     redirect effect in app/_layout.tsx, which is sync and re-fires on every
 *     `segments` change. An `await` there races into a double-navigate.
 *
 * Two layers, and they are not redundant: the module-level variable is the read
 * path, and the AsyncStorage mirror exists ONLY so the id survives process death
 * between tapping the link and finishing sign-up (which can include a full App
 * Store round trip). Storage failures are swallowed — losing the stash degrades
 * to "user lands on the tabs", and the documented recovery is to re-tap the link
 * in the group chat, which now works because the app is installed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isShareId } from '@/utils/shareLink';

export const PENDING_SHARE_KEY = '@cashcage:pendingShare';

let pending: string | null = null;

/**
 * Stash a shareId. Sets memory FIRST and synchronously, then mirrors to storage
 * fire-and-forget — the caller must never have to await this to make the value
 * visible to the redirect effect.
 */
export function setPendingShare(shareId: string): void {
  if (!isShareId(shareId)) return;
  pending = shareId;
  AsyncStorage.setItem(PENDING_SHARE_KEY, shareId).catch(() => {
    // Degrades to in-memory only; survives everything but process death.
  });
}

/** Return the pending id and clear it. Synchronous by contract — see the header. */
export function consumePendingShare(): string | null {
  const value = pending;
  pending = null;
  if (value !== null) {
    AsyncStorage.removeItem(PENDING_SHARE_KEY).catch(() => {});
  }
  return value;
}

/** Drop a pending id without acting on it. */
export function clearPendingShare(): void {
  pending = null;
  AsyncStorage.removeItem(PENDING_SHARE_KEY).catch(() => {});
}

/**
 * Read a stored id back into memory at launch.
 *
 * Never clobbers a value already set this session: a cold start can race a live
 * deep link, and the link the user just tapped is fresher intent than whatever a
 * previous run left behind.
 */
export async function hydratePendingShare(): Promise<void> {
  if (pending !== null) return;
  try {
    const stored = await AsyncStorage.getItem(PENDING_SHARE_KEY);
    if (pending !== null) return; // a link arrived while we were awaiting
    if (stored && isShareId(stored)) {
      pending = stored;
    } else if (stored) {
      await AsyncStorage.removeItem(PENDING_SHARE_KEY);
    }
  } catch {
    // No stash is a survivable state.
  }
}

/** Test-only: drop module state between cases. */
export function __resetPendingShareForTests(): void {
  pending = null;
}
