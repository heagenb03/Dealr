/**
 * The pure currency-formatter factory extracted out of CurrencyContext.
 *
 * Why the Intl-absent matrix is enumerated exhaustively here: this repo shipped a
 * broken no-Intl fallback through three clean reviews because the context's own
 * `installThrowingIntl` helper was pointed at only part of the surface. There are
 * three public formatters and two distinct failure modes (the CONSTRUCTOR throws,
 * versus the constructed object's `.format()` throws), and every one of the six
 * cells is asserted below.
 */
import { createCurrencyFormatters } from '@/utils/currencyFormat';

const RealNumberFormat = Intl.NumberFormat;

function installThrowingIntl() {
  (Intl as any).NumberFormat = function () {
    throw new Error('no Intl in this runtime');
  };
}

function installFormatThrowingIntl() {
  (Intl as any).NumberFormat = function () {
    return {
      format: () => {
        throw new Error('format failed at call time');
      },
    };
  };
}

afterEach(() => {
  (Intl as any).NumberFormat = RealNumberFormat;
});

describe('createCurrencyFormatters — normal Intl runtime', () => {
  it('formats USD exactly as CurrencyContext does today', () => {
    const f = createCurrencyFormatters('USD');
    expect(f.formatAmount(1234.56)).toBe('$1,234.56');
    expect(f.formatAmount(0)).toBe('$0.00');
  });

  it('formats an arbitrary currency the current user is NOT using — the whole point of the factory', () => {
    const f = createCurrencyFormatters('JPY');
    const expected = new RealNumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(1234.56);
    expect(f.formatAmount(1234.56)).toBe(expected);
  });

  it('exposes the currency meta', () => {
    expect(createCurrencyFormatters('EUR').meta).toMatchObject({ code: 'EUR', locale: 'de-DE', decimals: 2 });
  });

  it('compacts on the FLAT 1,000 threshold regardless of currency', () => {
    expect(createCurrencyFormatters('USD').formatAmountCompact(999.99)).toBe('$999.99');
    expect(createCurrencyFormatters('USD').formatAmountCompact(1234.56)).toBe('$1.2k');
    expect(createCurrencyFormatters('USD').formatAmountCompact(999950)).toBe('$1M');
    // JPY's default cash unit is 1,000, but the FLAT threshold ignores that.
    expect(createCurrencyFormatters('JPY').formatAmountCompact(1234)).toContain('k');
  });

  it('scales the compact threshold to the currency default cash unit', () => {
    // USD: 5 * 200 = 1,000 -> compacts at 1,000, same as the flat threshold.
    expect(createCurrencyFormatters('USD').formatAmountCompactScaled(1234.56)).toBe('$1.2k');
    expect(createCurrencyFormatters('USD').formatAmountCompactScaled(999.99)).toBe('$999.99');
    // JPY: 1000 * 200 = 200,000 -> 1,234 must NOT compact.
    const jpy = createCurrencyFormatters('JPY');
    expect(jpy.formatAmountCompactScaled(1234)).not.toContain('k');
    expect(jpy.formatAmountCompactScaled(1234)).toBe(jpy.formatAmount(1234));
    // ...but 200,500 must, and must NOT inherit JPY's 0 decimals (that would
    // round it to "201k" instead of "200.5k").
    expect(jpy.formatAmountCompactScaled(200500)).toContain('200.5');
    expect(jpy.formatAmountCompactScaled(200500)).toContain('k');
  });

  it('preserves sign', () => {
    expect(createCurrencyFormatters('USD').formatAmountCompact(-1500)).toBe('-$1.5k');
  });
});

describe('createCurrencyFormatters — Intl.NumberFormat throws at CONSTRUCTION time', () => {
  it('formatAmount falls back to symbol + toFixed(decimals)', () => {
    installThrowingIntl();
    expect(createCurrencyFormatters('USD').formatAmount(1234.56)).toBe('$1234.56');
    expect(createCurrencyFormatters('JPY').formatAmount(1234.56)).toBe('¥1235');
  });

  it('formatAmountCompact falls back to one-decimal precision, not a raw float', () => {
    installThrowingIntl();
    const f = createCurrencyFormatters('USD');
    // 1234.56 / 1000 = 1.2345599999999999 as a raw JS float.
    expect(f.formatAmountCompact(1234.56)).toBe('$1.2k');
    expect(f.formatAmountCompact(999950)).toBe('$1M');
    expect(f.formatAmountCompact(999.99)).toBe('$999.99');
  });

  it('formatAmountCompactScaled falls back the same way, on its own threshold', () => {
    installThrowingIntl();
    const usd = createCurrencyFormatters('USD');
    expect(usd.formatAmountCompactScaled(1234.56)).toBe('$1.2k');
    const jpy = createCurrencyFormatters('JPY');
    expect(jpy.formatAmountCompactScaled(1234)).toBe('¥1234');
    expect(jpy.formatAmountCompactScaled(200500)).toBe('¥200.5k');
  });
});

describe('createCurrencyFormatters — .format() throws at CALL time', () => {
  it('formatAmount falls back to symbol + toFixed(decimals)', () => {
    installFormatThrowingIntl();
    expect(createCurrencyFormatters('USD').formatAmount(1234.56)).toBe('$1234.56');
  });

  it('formatAmountCompact falls back through BOTH formatters', () => {
    installFormatThrowingIntl();
    const f = createCurrencyFormatters('USD');
    // Below threshold routes through formatAmount's catch...
    expect(f.formatAmountCompact(999.99)).toBe('$999.99');
    // ...at or above it, through formatScaled's catch.
    expect(f.formatAmountCompact(1234.56)).toBe('$1.2k');
    expect(f.formatAmountCompact(999950)).toBe('$1M');
  });

  it('formatAmountCompactScaled falls back through BOTH formatters', () => {
    installFormatThrowingIntl();
    const jpy = createCurrencyFormatters('JPY');
    expect(jpy.formatAmountCompactScaled(1234)).toBe('¥1234');
    expect(jpy.formatAmountCompactScaled(200500)).toBe('¥200.5k');
  });
});

describe('createCurrencyFormatters — construction cost', () => {
  it('builds exactly two Intl.NumberFormats per call, eagerly, not one per format() call', () => {
    let constructions = 0;
    (Intl as any).NumberFormat = function (...args: any[]) {
      constructions += 1;
      return new (RealNumberFormat as any)(...args);
    };
    const f = createCurrencyFormatters('USD');
    expect(constructions).toBe(2);
    for (let i = 0; i < 200; i += 1) {
      f.formatAmount(i);
      f.formatAmountCompact(i * 100);
      f.formatAmountCompactScaled(i * 100);
    }
    expect(constructions).toBe(2);
  });
});
