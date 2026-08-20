import { lastOfferedShareKeyFor, pickClipboardShare } from '@/utils/clipboardHandoff';

const ID = 'aB3dEfGh1JkLmN0pQrSt';
const OTHER = 'zZ9yYxXwWvVuUtTsSrRq';

describe('pickClipboardShare', () => {
  it('offers a fresh CC- token', () => {
    expect(pickClipboardShare({ clipboardText: `CC-${ID}`, lastOfferedId: null })).toBe(ID);
  });

  it('offers a token that was pasted with surrounding whitespace', () => {
    expect(pickClipboardShare({ clipboardText: `  CC-${ID}\n`, lastOfferedId: null })).toBe(ID);
  });

  it('does NOT re-offer an id already offered', () => {
    // Otherwise the prompt reappears on every launch until the user clears their
    // clipboard, which is nagging, not helping.
    expect(pickClipboardShare({ clipboardText: `CC-${ID}`, lastOfferedId: ID })).toBeNull();
  });

  it('offers a different id even when one was offered before', () => {
    expect(pickClipboardShare({ clipboardText: `CC-${OTHER}`, lastOfferedId: ID })).toBe(OTHER);
  });

  it('ignores an empty or absent clipboard', () => {
    expect(pickClipboardShare({ clipboardText: null, lastOfferedId: null })).toBeNull();
    expect(pickClipboardShare({ clipboardText: '', lastOfferedId: null })).toBeNull();
    expect(pickClipboardShare({ clipboardText: '   ', lastOfferedId: null })).toBeNull();
  });

  it('ignores ordinary clipboard contents', () => {
    // The overwhelmingly common case: the user copied something unrelated.
    expect(pickClipboardShare({ clipboardText: 'my password', lastOfferedId: null })).toBeNull();
    expect(pickClipboardShare({ clipboardText: 'https://example.com', lastOfferedId: null })).toBeNull();
    expect(pickClipboardShare({ clipboardText: 'CC-nope', lastOfferedId: null })).toBeNull();
  });

  it('does NOT fire on a bare 20-character word', () => {
    // parseShareId accepts a bare id because that is what expo-router hands the
    // ROUTE. The clipboard is a different trust level: only a token WE wrote
    // counts, or any 20-char alphanumeric string a user copied would prompt.
    expect(pickClipboardShare({ clipboardText: ID, lastOfferedId: null })).toBeNull();
  });

  it('does NOT fire on a share URL sitting on the clipboard', () => {
    // A copied URL is not a handoff — the user can just tap it, and the app is
    // installed, so it opens directly.
    expect(pickClipboardShare({
      clipboardText: `https://cashcage-app.web.app/g/${ID}`,
      lastOfferedId: null,
    })).toBeNull();
  });

  it('does NOT fire on a string that merely CONTAINS a CC- token mid-string', () => {
    // Anchoring proof: a token-shaped substring buried inside unrelated text must
    // not trigger the prompt. This is the same anchoring parseShareId enforces —
    // relaxing it here (e.g. via a scanning regex or an unanchored startsWith
    // check) would let arbitrary pasted text fire the handoff.
    expect(
      pickClipboardShare({ clipboardText: `hey check this out CC-${ID} thanks`, lastOfferedId: null }),
    ).toBeNull();
  });
});

describe('lastOfferedShareKeyFor', () => {
  it('produces a different storage key per uid', () => {
    // Direct discrimination proof: if this ever regressed to a device-global
    // key (ignoring uid), the two calls below would collide.
    expect(lastOfferedShareKeyFor('uid-A')).not.toBe(lastOfferedShareKeyFor('uid-B'));
  });

  it('scopes to the SAME key for the SAME uid, so an account still suppresses its own repeat offer', () => {
    expect(lastOfferedShareKeyFor('uid-A')).toBe(lastOfferedShareKeyFor('uid-A'));
  });

  it('does not let one account\'s decline suppress a different account\'s offer for the same shared game', () => {
    // Simulates exactly what ClipboardShareHandoff does: read this account's key,
    // decide via pickClipboardShare, and (on an offer) write the id back under
    // this account's own key BEFORE showing the prompt — using a tiny in-memory
    // stand-in for AsyncStorage so this stays jest-testable without the native
    // module.
    const store = new Map<string, string>();
    const offerFor = (uid: string, clipboardText: string): string | null => {
      const key = lastOfferedShareKeyFor(uid);
      const lastOfferedId = store.get(key) ?? null;
      const candidate = pickClipboardShare({ clipboardText, lastOfferedId });
      if (candidate) store.set(key, candidate);
      return candidate;
    };

    // Account A is offered the game and (per the real component) the id is
    // recorded under A's key regardless of what A does with the prompt.
    expect(offerFor('uid-A', `CC-${ID}`)).toBe(ID);

    // The SAME physical clipboard is read again for a different signed-in
    // account on the same device (e.g. account switch). B must still be
    // offered — A's decline must not silently consume B's offer.
    expect(offerFor('uid-B', `CC-${ID}`)).toBe(ID);

    // And A, asked again, is correctly NOT re-offered the same id.
    expect(offerFor('uid-A', `CC-${ID}`)).toBeNull();
  });
});
