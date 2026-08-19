/**
 * Currency formatter factory.
 *
 * Extracted out of CurrencyContext (which builds formatters closed over the
 * SIGNED-IN USER's currency) so that a screen can format in some OTHER currency —
 * specifically, a shared game snapshot carries the currency the game was played
 * in, which need not be the viewer's preference.
 *
 * No React here on purpose: jest-expo/node has no React Native renderer, so
 * anything reachable only through a provider is expensive to exercise. This file
 * is a plain function and its whole failure matrix is unit-testable.
 *
 * Both Intl.NumberFormat constructions happen EAGERLY, once per call. Callers are
 * expected to memoize per currency code — PlayerCardActive calls formatAmount 4x
 * per card, so a 50-player screen would otherwise construct ~200 formatters.
 * Construction can throw on a runtime with limited Intl support, so each is
 * caught and degrades to null; every format path also keeps its own catch for the
 * separate case where construction succeeds but `.format()` throws.
 */
import {
  CurrencyCode,
  CurrencyMeta,
  SUPPORTED_CURRENCIES,
} from '@/constants/Currencies';
import { getDefaultCashUnit } from '@/constants/CashUnits';
import {
  compactAmountFrom,
  compactThreshold,
  FLAT_COMPACT_THRESHOLD,
} from '@/utils/compactAmount';

export interface CurrencyFormatters {
  meta: CurrencyMeta;
  /** Full locale-formatted amount, e.g. "$1,234.56", "¥1,235", "1.234,56 €" */
  formatAmount: (value: number) => string;
  /**
   * Compact stat format at a flat 1,000 threshold, e.g. "$1.2k", "￥1.2k".
   * For summary and profile tiles, which show computed totals at a glance.
   */
  formatAmountCompact: (value: number) => string;
  /**
   * Compact format whose threshold scales with the currency's smallest banknote
   * (JPY does not truncate until ￥200,000). For the collapsed Settings row,
   * which echoes a value the host chose.
   */
  formatAmountCompactScaled: (value: number) => string;
}

export function createCurrencyFormatters(code: CurrencyCode): CurrencyFormatters {
  const meta = SUPPORTED_CURRENCIES[code];

  let numberFormat: Intl.NumberFormat | null;
  try {
    numberFormat = new Intl.NumberFormat(meta.locale, {
      style: 'currency',
      currency: meta.code,
      minimumFractionDigits: meta.decimals,
      maximumFractionDigits: meta.decimals,
    });
  } catch {
    numberFormat = null;
  }

  // Second formatter, for the already-divided value in a compact result.
  // Fraction digits are pinned 0-1 REGARDLESS of meta.decimals: JPY is a
  // 0-decimal currency, and inheriting that would round ￥200,500 to "￥201k"
  // instead of "￥200.5k".
  let scaledNumberFormat: Intl.NumberFormat | null;
  try {
    scaledNumberFormat = new Intl.NumberFormat(meta.locale, {
      style: 'currency',
      currency: meta.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
  } catch {
    scaledNumberFormat = null;
  }

  const formatAmount = (value: number): string => {
    if (numberFormat) {
      try {
        return numberFormat.format(value);
      } catch {
        // fall through to the symbol fallback below
      }
    }
    return `${meta.symbol}${value.toFixed(meta.decimals)}`;
  };

  // Renders an already-scaled value (e.g. 1.5 for "1.5k"). Falls back to a bare
  // symbol prefix if Intl is unavailable, so a missing Intl cannot take the
  // caller down. Not locale-correct in that path — nothing is. The suffix
  // ("k"/"M") is NOT missing here: spliceSuffix runs in compactAmount.ts's
  // compactAmountFrom, outside this function, so it's still appended to
  // whatever this returns.
  //
  // `scaled` arrives undivided by anything but the /1000 or /1e6 compactAmount
  // already did — it is a raw JS float (1234.56 / 1000 = 1.2345599999999999),
  // so it must be rounded to one decimal here, matching what the Intl path
  // above and formatAmount's own fallback both produce. parseFloat drops a
  // trailing ".0" so 1.0 renders "1", not "1.0".
  const formatScaled = (scaled: number): string => {
    if (scaledNumberFormat) {
      try {
        return scaledNumberFormat.format(scaled);
      } catch {
        // fall through
      }
    }
    return `${meta.symbol}${parseFloat(scaled.toFixed(1))}`;
  };

  // Threshold depends only on the currency code, so it is computed once here
  // rather than per call. This feeds formatAmountCompactScaled specifically;
  // formatAmountCompact uses the flat FLAT_COMPACT_THRESHOLD and never reads it.
  const scaledThreshold = compactThreshold(getDefaultCashUnit(code));

  return {
    meta,
    formatAmount,
    formatAmountCompact: (value: number): string =>
      compactAmountFrom(value, FLAT_COMPACT_THRESHOLD, formatAmount, formatScaled),
    formatAmountCompactScaled: (value: number): string =>
      compactAmountFrom(value, scaledThreshold, formatAmount, formatScaled),
  };
}
