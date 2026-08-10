/**
 * Compact currency display (k / M) that stays consistent with the app's full
 * currency formatter across all ten supported locales.
 *
 * Why this is hand-rolled instead of Intl's `notation: 'compact'`: that option
 * cannot be made consistent here. Measured at 1,500 — de-DE gives "1500,0 €",
 * de-CH gives "CHF 1500.0" and ja-JP gives "￥1500", i.e. no compaction at all,
 * while pt-BR gives "R$ 1,5 mil" and es-MX gives "1.5 k$". Raising the threshold
 * does not rescue it: German and Swiss start compacting at 10⁶ ("Mio.") but
 * Japanese starts at 10⁴ on the MYRIAD base ("￥1万"). The locale data disagrees
 * on base, suffix and placement simultaneously, so no single configuration works.
 *
 * The technique that does work: format the SCALED number through the ordinary
 * currency formatter, then splice a fixed "k"/"M" in after the last digit. That
 * inherits symbol side, decimal separator, spacing and sign from the locale
 * without this module knowing anything about any locale. It also uses only
 * `.format()` — deliberately not `formatToParts`, whose Hermes support is
 * unverified on device.
 *
 * Formatters are injected rather than constructed here, which is what makes this
 * testable: `jest-expo/node` has no React Native renderer, so anything that
 * needs the CurrencyProvider cannot be exercised at all.
 */

/** Settings-row threshold = the currency's smallest banknote × this. */
export const COMPACT_NOTE_MULTIPLIER = 200;

/**
 * Stat-tile threshold. Currency-independent on purpose: tiles show computed
 * totals at a glance, where truncating IS the feature. The Settings row echoes a
 * value the host typed, where precision matters — hence the separate scale.
 */
export const FLAT_COMPACT_THRESHOLD = 1_000;

/**
 * At or above this, render "M" rather than "k". At one decimal any value from
 * 999,950 up rounds to "1000.0k", which is the "$1000k" defect this replaces.
 * 999,949 still renders the more precise "$999.9k".
 */
export const M_PROMOTE = 999_950;

/**
 * Truncation threshold for the collapsed Settings row, scaled to the currency's
 * own smallest banknote. A flat 1,000 suits USD but is wrong by 200× for JPY,
 * whose default cash unit IS 1,000 — a flat rule would truncate the single most
 * common value in that currency, in every game, at default settings.
 */
export function compactThreshold(defaultCashUnit: number): number {
  return defaultCashUnit * COMPACT_NOTE_MULTIPLIER;
}

/**
 * Insert `suffix` immediately after the last ASCII digit in `formatted`.
 *   "$1.5"      + "k" -> "$1.5k"
 *   "1,5 €" + "k" -> "1,5k €"   (suffix lands before a trailing symbol)
 *   "-$1.5"     + "k" -> "-$1.5k"     (leading sign untouched)
 * Appends if there is no digit at all. Unreachable with real formatter output;
 * it exists so a NaN-ish string degrades visibly rather than dropping the suffix.
 */
export function spliceSuffix(formatted: string, suffix: string): string {
  for (let i = formatted.length - 1; i >= 0; i--) {
    const ch = formatted[i];
    if (ch >= '0' && ch <= '9') {
      return formatted.slice(0, i + 1) + suffix + formatted.slice(i + 1);
    }
  }
  return formatted + suffix;
}

/**
 * @param value        the real amount, sign included
 * @param threshold    below this, no truncation happens at all
 * @param fullFormat   renders a value verbatim (the app's normal currency format)
 * @param scaledFormat renders an already-divided value at 0-1 fraction digits
 *
 * Sign is PRESERVED. Do not add Math.abs — a caller that prepends its own sign
 * must stop doing so, or negatives render "--$1.5k".
 *
 * Latent, not reachable today: a currency whose default cash unit exceeded
 * ~5,000 would get a threshold above M_PROMOTE and skip the "k" branch entirely.
 * JPY's 200,000 is the largest today. If such a currency is ever introduced,
 * `compactThreshold` is the single place to add a `Math.min(..., M_PROMOTE)`
 * clamp — this function's threshold parameter would not need to change.
 */
export function compactAmountFrom(
  value: number,
  threshold: number,
  fullFormat: (n: number) => string,
  scaledFormat: (n: number) => string,
): string {
  const abs = Math.abs(value);
  if (abs < threshold) return fullFormat(value);
  if (abs >= M_PROMOTE) return spliceSuffix(scaledFormat(value / 1_000_000), 'M');
  return spliceSuffix(scaledFormat(value / 1_000), 'k');
}
