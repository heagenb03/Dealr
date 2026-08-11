import { getNetBalanceColor, netBalanceDisplay, formatStatNumber } from '../formatUtils';

describe('getNetBalanceColor', () => {
  it('returns green (#4CAF50) for positive balance', () => {
    expect(getNetBalanceColor(100)).toBe('#4CAF50');
  });

  it('returns red (#C04657) for negative balance', () => {
    expect(getNetBalanceColor(-50)).toBe('#C04657');
  });

  it('returns green (#4CAF50) for zero balance', () => {
    expect(getNetBalanceColor(0)).toBe('#4CAF50');
  });

  it('returns green for small positive value', () => {
    expect(getNetBalanceColor(0.01)).toBe('#4CAF50');
  });

  it('returns red for small negative value', () => {
    expect(getNetBalanceColor(-0.01)).toBe('#C04657');
  });
});

describe('netBalanceDisplay', () => {
  // A fake formatter, deliberately not a currency one: the rule under test is
  // "who owns the sign", and a real formatter would drag ten locales into it.
  // This fake emits its own minus exactly as formatAmountCompact does.
  const fake = (n: number) => (n < 0 ? `-<${Math.abs(n)}>` : `<${n}>`);

  it('prepends + to a positive net', () => {
    expect(netBalanceDisplay(125, fake)).toBe('+<125>');
  });

  it('prepends nothing to a negative net, leaving the formatter minus as the only one', () => {
    // Guards the "--$1.5k" double-minus: this is the exact defect that routing
    // a Math.abs-style caller into the new formatter produces.
    expect(netBalanceDisplay(-1500, fake)).toBe('-<1500>');
  });

  it('prepends nothing to a zero net', () => {
    expect(netBalanceDisplay(0, fake)).toBe('<0>');
  });
});

describe('formatStatNumber', () => {
  it('formats a count below 1,000 verbatim', () => {
    expect(formatStatNumber(999)).toBe('999');
  });

  it('formats 1,000 as 1k', () => {
    expect(formatStatNumber(1_000)).toBe('1k');
  });

  it('keeps one decimal just below the M boundary', () => {
    expect(formatStatNumber(999_949)).toBe('999.9k');
  });

  it('promotes to M at 999,950 rather than rendering 1000k', () => {
    // 999950 / 1000 = 999.95, .toFixed(1) = "1000.0" -> "1000k".
    // Same defect class the currency formatter already fixed.
    expect(formatStatNumber(999_950)).toBe('1M');
  });
});
