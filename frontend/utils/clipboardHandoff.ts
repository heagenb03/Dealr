/**
 * Should the launch-time prompt offer a shared game from the clipboard?
 *
 * Deliberately STRICTER than parseShareId. parseShareId accepts a bare id
 * because that is what expo-router hands the route, and accepts a full URL
 * because that is what a universal link carries. The clipboard is a different
 * trust level: it holds whatever the user last copied, so only the exact
 * `CC-<id>` token that public/g/index.html writes counts as a handoff.
 *
 * A share URL on the clipboard is deliberately NOT a handoff either — if the app
 * is installed, tapping that link opens it directly, so prompting would be noise.
 *
 * ANCHORED via startsWith, not scanned: a token-shaped substring buried inside
 * unrelated pasted text (a chat message, a note) must not fire this. Only a
 * clipboard whose (trimmed) content BEGINS with the exact CC- prefix counts.
 */
import { CLIPBOARD_PREFIX, isShareId } from '@/utils/shareLink';

export function pickClipboardShare(params: {
  clipboardText: string | null;
  /** The last id we already prompted about; null if we never have. */
  lastOfferedId: string | null;
}): string | null {
  const { clipboardText, lastOfferedId } = params;
  if (!clipboardText) return null;

  const trimmed = clipboardText.trim();
  if (!trimmed.startsWith(CLIPBOARD_PREFIX)) return null;

  const candidate = trimmed.slice(CLIPBOARD_PREFIX.length);
  if (!isShareId(candidate)) return null;

  // Offer each id once. Otherwise the prompt returns on every launch until the
  // user clears their clipboard — nagging, not helping.
  if (candidate === lastOfferedId) return null;

  return candidate;
}
