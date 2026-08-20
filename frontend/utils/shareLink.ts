/**
 * The one place the shared-game link shape is defined -- for the CONSUMER
 * side only. Read this carefully before trusting the phrase "defined once":
 * it is true for parsing, not for producing.
 *
 * Two textual forms carry a shareId (spec §6): the https URL, handed to
 * app/g/[shareId].tsx by expo-router after a universal-link tap, and the
 * CC- token, read back from the clipboard by the app after a fresh install.
 * Both are PARSED here, by parseShareId, so parsing can't drift.
 *
 * They are NOT both PRODUCED here. buildShareUrl is the real producer of the
 * https form. The CC- token's real producer is public/g/index.html -- a
 * static page shipped as-is to Firebase Hosting, which cannot import this
 * module (or run any TypeScript) at all. That page hand-rolls its own
 * `'CC-' + match[1]` and its own `[A-Za-z0-9]{20}` id pattern, independently
 * of CLIPBOARD_PREFIX and SHARE_ID_RE below -- and, since the expiry landed,
 * its own copy of EXPIRY_PARAM. buildClipboardToken exists only
 * for tests; nothing in production calls it, and it cannot enforce that the
 * doormat page agrees with the constants here. Change CLIPBOARD_PREFIX or
 * SHARE_ID_RE without also updating public/g/index.html by hand, and every
 * test in this file still passes while the doormat emits a token the app
 * rejects. The only thing that catches that is the drift-guard test in
 * __tests__/shareLink.test.ts, which reads public/g/index.html off disk.
 *
 * No react-native import — this must stay unit-testable under jest-expo/node.
 */

/** Firebase Hosting site for project `cashcage-app` (.firebaserc). */
export const SHARE_BASE_URL = 'https://cashcage-app.web.app/g/';

/** Prefix for the clipboard handoff token written by public/g/index.html. */
export const CLIPBOARD_PREFIX = 'CC-';

/**
 * Query parameter carrying the link's expiry, in whole unix seconds.
 *
 * ADVISORY, and only for public/g/index.html. That page cannot read the shared
 * document to find out: firestore.rules requires `request.auth != null` for a
 * get, and a web visitor is unauthenticated, so the read is denied before
 * `expiresAt` is ever evaluated -- the page could not tell expired from valid
 * from nonexistent. Carrying the expiry in the URL lets it say "this expired"
 * instead of pitching an install that lands on the same message anyway.
 *
 * NOT a security control. It is user-visible and editable, and the real expiry
 * is enforced by the rules on every read. It is also STALE after a re-share:
 * publishSharedGame rewrites expiresAt 30 days out while an older chat message
 * still carries the first value, so an old link can report expired while the
 * document is alive. That reaches only a recipient without the app, whose next
 * step -- install, ask for a fresh link -- is what the page already tells them.
 *
 * The consumer is hand-rolled JS in a static HTML file that cannot import this
 * module. The drift guard in __tests__/shareLink.test.ts is the only thing
 * holding the two copies to the same parameter name.
 */
export const EXPIRY_PARAM = 'e';

/**
 * Firestore auto-IDs are exactly 20 characters over a 62-char alphabet
 * ([A-Za-z0-9]) — ~119 bits, which is what makes the URL itself the credential.
 * Deliberately strict: a dash or underscore means it did not come from
 * Firestore, so it is not a shareId we minted.
 */
const SHARE_ID_RE = /^[A-Za-z0-9]{20}$/;

export function isShareId(value: string): boolean {
  return SHARE_ID_RE.test(value);
}

export function buildShareUrl(shareId: string, expiresAt?: Date): string {
  const url = `${SHARE_BASE_URL}${shareId}`;
  // An Invalid Date would emit `?e=NaN`, which the doormat's parseInt turns
  // back into NaN and every comparison against it is false -- harmless, but it
  // puts visible garbage in a link people read. Omit it instead.
  if (!expiresAt || !Number.isFinite(expiresAt.getTime())) return url;
  return `${url}?${EXPIRY_PARAM}=${Math.floor(expiresAt.getTime() / 1000)}`;
}

/**
 * Test-only. The real producer of this token shape is public/g/index.html,
 * not this function -- see the module docstring above. Nothing in production
 * calls this.
 */
export function buildClipboardToken(shareId: string): string {
  return `${CLIPBOARD_PREFIX}${shareId}`;
}

/**
 * Pull a shareId out of a share URL, a CC- clipboard token, or a bare id.
 *
 * ANCHORED on purpose. It is tempting to scan a pasted chat message for a URL,
 * but the only two producers are the doormat page (which writes the token and
 * nothing else) and expo-router (which hands over a bare path segment). Matching
 * mid-sentence would let unrelated clipboard contents trigger the launch prompt.
 *
 * Returns null on anything that is not one of those three forms — including a
 * well-formed URL on the wrong host.
 */
export function parseShareId(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(CLIPBOARD_PREFIX)) {
    const candidate = trimmed.slice(CLIPBOARD_PREFIX.length);
    return isShareId(candidate) ? candidate : null;
  }

  if (trimmed.startsWith(SHARE_BASE_URL)) {
    // Strip a query string / fragment / trailing slash before validating, so a
    // link that picked up chat-app tracking params still resolves.
    const rest = trimmed.slice(SHARE_BASE_URL.length);
    const candidate = rest.split(/[?#/]/)[0];
    return isShareId(candidate) ? candidate : null;
  }

  return isShareId(trimmed) ? trimmed : null;
}
