import { fallbackBannerCopy } from '../fallbackBannerCopy';

const fmt = (n: number) => `$${n.toFixed(2)}`;

describe('fallbackBannerCopy', () => {
  it('shows the optimizing message while a retry is in flight', () => {
    expect(fallbackBannerCopy(true, true, 0, 2.5, fmt)).toBe('Optimizing settlements...');
  });

  it('shows the server-unreachable message when retryable and not retrying', () => {
    expect(fallbackBannerCopy(true, false, 0, 2.5, fmt)).toBe(
      "Couldn't reach server. Settlements are non-optimized",
    );
  });

  it('names the imbalance amounts when over tolerance', () => {
    const text = fallbackBannerCopy(false, false, 8, 2.5, fmt);
    expect(text).toContain('$8.00');
    expect(text).toContain('$2.50');
    expect(text).toContain('best-effort estimate');
  });

  it('stays generic for a non-imbalance rejection (netDifference within tolerance)', () => {
    expect(fallbackBannerCopy(false, false, 1, 2.5, fmt)).toBe(
      "Couldn't optimize these settlements. They're a best-effort estimate.",
    );
  });
});
