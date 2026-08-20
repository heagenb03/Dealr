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
