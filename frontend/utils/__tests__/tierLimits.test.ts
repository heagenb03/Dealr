import {
  FREE_PLAYER_CAP,
  PRO_PLAYER_CAP,
  FREE_HISTORY_LIMIT,
  playerCapFor,
  canAddMorePlayers,
  splitCompletedHistory,
} from '../tierLimits';

describe('player caps', () => {
  it('exposes the documented cap values', () => {
    expect(FREE_PLAYER_CAP).toBe(12);
    // The firestore.rules ceiling is TARGETED to sit higher than this (100) so the
    // app cap can rise later without a rules deploy — but that deploy is a separate,
    // human-operated step. As of this commit the DEPLOYED rule is still 20, i.e.
    // BELOW this constant. If this test fails because someone raised PRO_PLAYER_CAP,
    // confirm the DEPLOYED rule still exceeds it before updating — a cap above the
    // deployed rule causes silent, permanent sync loss.
    expect(PRO_PLAYER_CAP).toBe(50);
  });

  it('resolves the cap per tier', () => {
    expect(playerCapFor(false)).toBe(12);
    expect(playerCapFor(true)).toBe(50);
  });

  it('allows adding below the cap', () => {
    expect(canAddMorePlayers(11, false)).toBe(true);
    expect(canAddMorePlayers(49, true)).toBe(true);
  });

  it('blocks adding at the cap', () => {
    expect(canAddMorePlayers(12, false)).toBe(false);
    expect(canAddMorePlayers(50, true)).toBe(false);
  });

  it('blocks adding over the cap (grandfathered state)', () => {
    expect(canAddMorePlayers(17, false)).toBe(false);
    expect(canAddMorePlayers(55, true)).toBe(false);
  });

  it('gates on count vs tier cap, never on tier alone', () => {
    // A free user below their own cap can still add.
    expect(canAddMorePlayers(0, false)).toBe(true);
  });

  it('lets a Pro user past the OLD cap of 20', () => {
    // Regression guard for the raise itself: 20 and 25 were both hard blocks before.
    expect(canAddMorePlayers(20, true)).toBe(true);
    expect(canAddMorePlayers(25, true)).toBe(true);
  });
});

describe('splitCompletedHistory', () => {
  const many = Array.from({ length: 30 }, (_, i) => `g${i}`);

  it('shows every game to Pro and hides none', () => {
    const { visible, hiddenCount } = splitCompletedHistory(many, true);
    expect(visible).toHaveLength(30);
    expect(hiddenCount).toBe(0);
  });

  it('shows the free limit and reports the remainder', () => {
    const { visible, hiddenCount } = splitCompletedHistory(many, false);
    expect(visible).toHaveLength(FREE_HISTORY_LIMIT);
    expect(hiddenCount).toBe(20);
  });

  it('keeps the newest games, in order', () => {
    const { visible } = splitCompletedHistory(many, false);
    expect(visible[0]).toBe('g0');
    expect(visible[9]).toBe('g9');
  });

  // D1 GRANDFATHER INVARIANT: display-only. The input is never mutated and no
  // game is dropped from the caller's array.
  it('never mutates or truncates the source array', () => {
    const source = [...many];
    splitCompletedHistory(source, false);
    expect(source).toHaveLength(30);
    expect(source).toEqual(many);
  });

  it('reports no hidden games below the limit', () => {
    const { visible, hiddenCount } = splitCompletedHistory(['a', 'b'], false);
    expect(visible).toEqual(['a', 'b']);
    expect(hiddenCount).toBe(0);
  });

  it('handles an empty history', () => {
    expect(splitCompletedHistory([], false)).toEqual({ visible: [], hiddenCount: 0 });
  });
});
