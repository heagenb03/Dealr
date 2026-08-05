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

  it('names a slow solve rather than an unreachable server when it timed out', () => {
    expect(fallbackBannerCopy(true, false, 0, 2.5, fmt, true)).toBe(
      'Optimizing took too long. These settlements are correct, just possibly not the fewest payments.',
    );
  });

  it('still leads with the imbalance when a timeout lands on an out-of-tolerance table', () => {
    const text = fallbackBannerCopy(false, false, 8, 2.5, fmt, true);
    expect(text).toContain('$8.00');
    expect(text).toContain('best-effort estimate');
    expect(text).not.toContain('These settlements are correct');
  });

  it('never claims the server was unreachable when the solve timed out', () => {
    for (const retryable of [true, false]) {
      for (const netDifference of [0, 1, 8]) {
        const text = fallbackBannerCopy(retryable, false, netDifference, 2.5, fmt, true);
        expect(text).not.toContain("Couldn't reach server");
      }
    }
  });

  it('keeps the retry message while a retry is in flight even on a timeout', () => {
    expect(fallbackBannerCopy(true, true, 0, 2.5, fmt, true)).toBe('Optimizing settlements...');
  });
});
