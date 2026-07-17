import { CurrencyCode } from '@/constants/Currencies';

/** Exact = warn on ANY real imbalance; the solver never fudges balances. */
export const EXACT_TOLERANCE = 0;

interface TolerancePreset {
  /** The "Normal" default when a game has no explicit override. */
  default: number;
  /** Non-zero curated options, ascending. Native currency units. */
  steps: number[];
}

// Hand-curated round numbers ≈ "a couple dollars", per currency. NOT FX-derived.
const TOLERANCE_PRESETS: Record<CurrencyCode, TolerancePreset> = {
  USD: { default: 2.5, steps: [2.5, 5, 10, 20, 50] },
  EUR: { default: 2.5, steps: [2.5, 5, 10, 20, 50] },
  GBP: { default: 2.5, steps: [2.5, 5, 10, 20, 50] },
  CAD: { default: 2.5, steps: [2.5, 5, 10, 20, 50] },
  AUD: { default: 2.5, steps: [2.5, 5, 10, 20, 50] },
  CHF: { default: 2.5, steps: [2.5, 5, 10, 20, 50] },
  JPY: { default: 250, steps: [250, 500, 1000, 2000, 5000] },
  INR: { default: 200, steps: [200, 500, 1000, 2000, 5000] },
  BRL: { default: 10, steps: [10, 25, 50, 100, 250] },
  MXN: { default: 40, steps: [40, 100, 200, 500, 1000] },
};

function presetFor(currency: CurrencyCode): TolerancePreset {
  return TOLERANCE_PRESETS[currency] ?? TOLERANCE_PRESETS.USD;
}

/** Ordered picker options: [Exact(0), ...currency steps]. */
export function getToleranceOptions(currency: CurrencyCode): number[] {
  return [EXACT_TOLERANCE, ...presetFor(currency).steps];
}

/** The "Normal" default tolerance for a currency. */
export function getDefaultTolerance(currency: CurrencyCode): number {
  return presetFor(currency).default;
}

/**
 * Resolve a stored tolerance against the game's currency. A value picked under
 * one currency is meaningless in another, so anything that isn't a valid option
 * for `currency` falls back to that currency's default. Exact (0) is valid
 * everywhere. `undefined` (old games / never set) → currency default.
 */
export function resolveTolerance(
  tolerance: number | undefined,
  currency: CurrencyCode,
): number {
  if (tolerance !== undefined && getToleranceOptions(currency).includes(tolerance)) {
    return tolerance;
  }
  return getDefaultTolerance(currency);
}

/** Semantic label for a picker row (or null for the mid steps). */
export function toleranceSemantic(
  value: number,
  currency: CurrencyCode,
): 'Exact' | 'Strict' | 'Normal' | 'Loose' | null {
  if (value === EXACT_TOLERANCE) return 'Exact';
  const preset = presetFor(currency);
  const max = preset.steps[preset.steps.length - 1];
  if (value === preset.default) return 'Normal';
  if (value === max) return 'Loose';
  if (value < preset.default) return 'Strict';
  return null;
}
