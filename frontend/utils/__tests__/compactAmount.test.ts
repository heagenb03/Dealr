import {
  compactAmountFrom,
  compactThreshold,
  spliceSuffix,
  FLAT_COMPACT_THRESHOLD,
} from '../compactAmount';
import { SUPPORTED_CURRENCIES, CurrencyCode } from '@/constants/Currencies';
import { getDefaultCashUnit } from '@/constants/CashUnits';

// Builds the same formatter pair CurrencyContext will build, so these tests
// exercise real Intl output rather than a stub that could drift from it.
function formattersFor(code: CurrencyCode) {
  const meta = SUPPORTED_CURRENCIES[code];
  const full = new Intl.NumberFormat(meta.locale, {
    style: 'currency',
    currency: meta.code,
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  });
  // 0-1 fraction digits REGARDLESS of meta.decimals: JPY is a 0-decimal
  // currency, and inheriting that would round 200,500 to "201k" not "200.5k".
  const scaled = new Intl.NumberFormat(meta.locale, {
    style: 'currency',
    currency: meta.code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  return {
    full: (n: number) => full.format(n),
    scaled: (n: number) => scaled.format(n),
  };
}

/** Collapsed Settings row: threshold scales with the currency's smallest note. */
function row(code: CurrencyCode, value: number): string {
  const f = formattersFor(code);
  return compactAmountFrom(
    value,
    compactThreshold(getDefaultCashUnit(code)),
    f.full,
    f.scaled,
  );
}

/** Summary / profile stat tiles: flat threshold. */
function tile(code: CurrencyCode, value: number): string {
  const f = formattersFor(code);
  return compactAmountFrom(value, FLAT_COMPACT_THRESHOLD, f.full, f.scaled);
}

// NOTE ON ESCAPES: every non-ASCII character below is written as \uXXXX on
// purpose. de-DE, pt-BR and de-CH separate the symbol with U+00A0 (NON-BREAKING
// SPACE), which is indistinguishable from a normal space in a diff or a terminal
// and will silently fail an equality assertion. de-CH's group separator is
// U+2019, not an ASCII apostrophe. Intl returns JPY as U+FFE5 (fullwidth), not
// the U+00A5 character stored in Currencies.ts. Do NOT "clean these up".

describe('spliceSuffix', () => {
  it('inserts after the last digit, before a trailing symbol', () => {
    expect(spliceSuffix('$1.5', 'k')).toBe('$1.5k');
    expect(spliceSuffix('1,5\u00a0\u20ac', 'k')).toBe('1,5k\u00a0\u20ac');
    expect(spliceSuffix('CHF\u00a01.5', 'k')).toBe('CHF\u00a01.5k');
  });

  it('preserves a leading minus sign', () => {
    expect(spliceSuffix('-$1.5', 'k')).toBe('-$1.5k');
  });

  it('appends when there is no digit at all', () => {
    expect(spliceSuffix('NaN', 'k')).toBe('NaNk');
    expect(spliceSuffix('', 'M')).toBe('M');
  });
});

describe('compactThreshold', () => {
  it('scales each currency by its smallest banknote', () => {
    // JPY's default cash unit IS 1,000, so a flat rule would truncate the most
    // common value in that currency. This table is the reason the split exists.
    const expected: Record<CurrencyCode, number> = {
      USD: 1000, EUR: 1000, GBP: 1000, CAD: 1000, AUD: 1000,
      JPY: 200000, INR: 10000, BRL: 2000, MXN: 10000, CHF: 2000,
    };
    for (const code of Object.keys(expected) as CurrencyCode[]) {
      expect(compactThreshold(getDefaultCashUnit(code))).toBe(expected[code]);
    }
  });
});

describe('compactAmountFrom — USD boundaries', () => {
  it('leaves sub-threshold amounts exactly as formatAmount would', () => {
    expect(row('USD', 0)).toBe('$0.00');
    expect(row('USD', 999)).toBe('$999.00');
    expect(row('USD', 999.99)).toBe('$999.99');
  });

  it('compacts at and above the threshold, to one decimal', () => {
    expect(row('USD', 1000)).toBe('$1k');
    expect(row('USD', 1049)).toBe('$1k');
    expect(row('USD', 1050)).toBe('$1.1k');
    expect(row('USD', 1500)).toBe('$1.5k');
    expect(row('USD', 9999)).toBe('$10k');
    expect(row('USD', 10000)).toBe('$10k');
  });

  it('promotes to M instead of rendering "$1000k"', () => {
    // Regression pin: at one decimal, 999,950+ rounds to 1000.0k. The old
    // formatter shipped "$1000k" for 999,999.
    expect(row('USD', 999949)).toBe('$999.9k');
    expect(row('USD', 999950)).toBe('$1M');
    expect(row('USD', 1000000)).toBe('$1M');
  });

  it('preserves the sign', () => {
    // Regression pin for the removed Math.abs. summary.tsx prepends its own
    // sign, so if this ever returns an unsigned string again, that screen
    // silently loses the minus.
    expect(row('USD', -1500)).toBe('-$1.5k');
    expect(row('USD', -999999)).toBe('-$1M');
  });
});

describe('compactAmountFrom — per-currency scaled row', () => {
  it('does not truncate JPY at its own default cash unit', () => {
    expect(row('JPY', 1000)).toBe('\uffe51,000');
    expect(row('JPY', 5000)).toBe('\uffe55,000');
  });

  it('compacts JPY once past its scaled threshold', () => {
    expect(row('JPY', 200000)).toBe('\uffe5200k');
    expect(row('JPY', 200500)).toBe('\uffe5200.5k');
  });

  it('places the symbol the way the locale does', () => {
    expect(row('EUR', 1000)).toBe('1k\u00a0\u20ac');
    expect(row('EUR', 1500000)).toBe('1,5M\u00a0\u20ac');
    expect(row('BRL', 2000)).toBe('R$\u00a02k');
    expect(row('CHF', 2000)).toBe('CHF\u00a02k');
    expect(row('GBP', 1000)).toBe('\u00a31k');
    expect(row('INR', 10000)).toBe('\u20b910k');
  });

  it('drops the CA$/A$/MX$ prefix, matching formatAmount', () => {
    // formatAmount renders a bare "$" for these three, so compact must too.
    // Invisible to a USD-only assertion set — this is the only pin.
    expect(row('CAD', 1500)).toBe('$1.5k');
    expect(row('AUD', 1500)).toBe('$1.5k');
    expect(row('MXN', 10000)).toBe('$10k');
  });
});

describe('the flat and scaled thresholds are genuinely different', () => {
  it('diverges for the five currencies whose default note is not 5', () => {
    // If anyone "simplifies" the two formatters into one, every other test in
    // this file still passes: USD/EUR/GBP/CAD/AUD produce identical output
    // under both thresholds. This is the only test that fails.
    expect(tile('JPY', 1000)).toBe('\uffe51k');
    expect(row('JPY', 1000)).toBe('\uffe51,000');

    expect(tile('JPY', 150000)).toBe('\uffe5150k');
    expect(row('JPY', 150000)).toBe('\uffe5150,000');

    expect(tile('INR', 5000)).toBe('\u20b95k');
    expect(row('INR', 5000)).toBe('\u20b95,000.00');

    expect(tile('MXN', 5000)).toBe('$5k');
    expect(row('MXN', 5000)).toBe('$5,000.00');

    expect(tile('BRL', 1500)).toBe('R$\u00a01,5k');
    expect(row('BRL', 1500)).toBe('R$\u00a01.500,00');

    expect(tile('CHF', 1500)).toBe('CHF\u00a01.5k');
    expect(row('CHF', 1500)).toBe('CHF\u00a01\u2019500.00');
  });

  it('agrees for USD, where both thresholds are 1,000', () => {
    expect(tile('USD', 1000)).toBe('$1k');
    expect(row('USD', 1000)).toBe('$1k');
  });
});
