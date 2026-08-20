import { pickClipboardShare } from '@/utils/clipboardHandoff';

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
