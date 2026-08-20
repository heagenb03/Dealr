import fs from 'fs';
import path from 'path';
import {
  SHARE_BASE_URL,
  CLIPBOARD_PREFIX,
  buildShareUrl,
  buildClipboardToken,
  isShareId,
  parseShareId,
} from '@/utils/shareLink';

// A realistic Firestore auto-ID: 20 chars over [A-Za-z0-9].
const ID = 'aB3dEfGh1JkLmN0pQrSt';

describe('shareLink constants', () => {
  it('points at the Firebase Hosting domain from .firebaserc', () => {
    expect(SHARE_BASE_URL).toBe('https://cashcage-app.web.app/g/');
    expect(CLIPBOARD_PREFIX).toBe('CC-');
  });
});

describe('buildShareUrl / buildClipboardToken', () => {
  it('builds the https link and the clipboard token', () => {
    expect(buildShareUrl(ID)).toBe(`https://cashcage-app.web.app/g/${ID}`);
    expect(buildClipboardToken(ID)).toBe(`CC-${ID}`);
  });

  it('round-trips through parseShareId', () => {
    expect(parseShareId(buildShareUrl(ID))).toBe(ID);
    expect(parseShareId(buildClipboardToken(ID))).toBe(ID);
  });
});

describe('isShareId', () => {
  it('accepts exactly 20 alphanumeric characters', () => {
    expect(isShareId(ID)).toBe(true);
  });

  it('rejects wrong lengths and non-alphanumerics', () => {
    expect(isShareId('')).toBe(false);
    expect(isShareId('short')).toBe(false);
    expect(isShareId('a'.repeat(19))).toBe(false);
    expect(isShareId('a'.repeat(21))).toBe(false);
    // Firestore auto-IDs are [A-Za-z0-9] only — no dashes or underscores.
    expect(isShareId('aB3dEfGh1JkLmN0pQr-t')).toBe(false);
    expect(isShareId('aB3dEfGh1JkLmN0pQr_t')).toBe(false);
  });
});

describe('parseShareId', () => {
  it('extracts the id from a plain share URL', () => {
    expect(parseShareId(`https://cashcage-app.web.app/g/${ID}`)).toBe(ID);
  });

  it('tolerates a trailing slash, a query string and a fragment', () => {
    expect(parseShareId(`https://cashcage-app.web.app/g/${ID}/`)).toBe(ID);
    expect(parseShareId(`https://cashcage-app.web.app/g/${ID}?utm=x`)).toBe(ID);
    expect(parseShareId(`https://cashcage-app.web.app/g/${ID}#top`)).toBe(ID);
  });

  it('tolerates surrounding whitespace, as pasted from a chat app', () => {
    expect(parseShareId(`  CC-${ID}\n`)).toBe(ID);
    expect(parseShareId(`  https://cashcage-app.web.app/g/${ID}  `)).toBe(ID);
  });

  it('accepts a bare id, which is what expo-router hands the route', () => {
    expect(parseShareId(ID)).toBe(ID);
  });

  it('returns null for anything else', () => {
    expect(parseShareId(null)).toBeNull();
    expect(parseShareId(undefined)).toBeNull();
    expect(parseShareId('')).toBeNull();
    expect(parseShareId('https://example.com/g/' + ID)).toBeNull();
    expect(parseShareId('https://cashcage-app.web.app/privacy.html')).toBeNull();
    expect(parseShareId('CC-tooshort')).toBeNull();
    expect(parseShareId('Hey check this out')).toBeNull();
  });

  it('does not match a share URL buried in a longer chat message', () => {
    // The clipboard handoff must fire only on a token we wrote, and the route
    // gets a bare id. Neither case is ever a sentence, so anchoring is correct.
    expect(parseShareId(`look: https://cashcage-app.web.app/g/${ID} !`)).toBeNull();
  });
});

describe('doormat drift guard', () => {
  // public/g/index.html is a static page shipped as-is to Firebase Hosting.
  // It cannot import this module, so it hand-rolls its own copy of
  // CLIPBOARD_PREFIX and the [A-Za-z0-9]{20} id pattern (mirroring the
  // private SHARE_ID_RE above). Nothing else in this test file, and nothing
  // in production, checks that the doormat's hand-rolled copy still agrees
  // with the constants here -- change CLIPBOARD_PREFIX without touching the
  // doormat and every other test in this file stays green while the doormat
  // emits a token the app rejects. This test is that check.
  const DOORMAT_PATH = path.join(__dirname, '..', '..', '..', 'public', 'g', 'index.html');
  const doormatSource = fs.readFileSync(DOORMAT_PATH, 'utf8');

  it('builds the clipboard token with the current CLIPBOARD_PREFIX', () => {
    expect(doormatSource).toContain(`'${CLIPBOARD_PREFIX}' + match[1]`);
  });

  it('matches shareIds with the current id pattern', () => {
    // Mirrors SHARE_ID_RE's core, which is not exported: exactly 20 chars
    // over [A-Za-z0-9]. isShareId is the exported gate on that same pattern,
    // asserted against real examples so this test can't silently point at a
    // pattern isShareId itself no longer enforces.
    expect(isShareId('a'.repeat(20))).toBe(true);
    expect(isShareId('a'.repeat(19))).toBe(false);
    expect(doormatSource).toContain('[A-Za-z0-9]{20}');
  });
});
