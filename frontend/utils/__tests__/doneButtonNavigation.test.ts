/**
 * Fix A: both "Done" buttons on the game summary must UNWIND the stack
 * (router.dismissAll()), matching the header back button at
 * app/(tabs)/_layout.tsx:139, rather than PUSH a new route.
 *
 * This is a source-level pin, not a behavior test: it guards the two call sites
 * against a silent revert. Actual navigation is verified on device.
 *
 * router.back() is asserted ABSENT on purpose — from [index, active, summary]
 * it lands the user back on the active screen of the game they just finished,
 * which is the trap this fix has to avoid.
 */
import fs from 'fs';
import path from 'path';

const SUMMARY = path.join(
  __dirname, '..', '..', 'app', '(tabs)', '(home)', 'game', 'summary.tsx'
);

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('game summary "Done" navigation', () => {
  const source = fs.readFileSync(SUMMARY, 'utf8');

  it('has no router.push("/") — that adds a route instead of unwinding', () => {
    expect(countOccurrences(source, "router.push('/')")).toBe(0);
  });

  it('calls router.dismissAll() from both Done buttons', () => {
    expect(countOccurrences(source, 'router.dismissAll()')).toBe(2);
  });

  it('does not use router.back(), which would land on the completed game', () => {
    expect(countOccurrences(source, 'router.back()')).toBe(0);
  });

  it('leaves the unrelated navigation calls alone', () => {
    expect(countOccurrences(source, "router.push('/how-it-works' as any)")).toBe(1);
    expect(countOccurrences(source, "router.replace('/game/active' as any)")).toBe(1);
  });
});
