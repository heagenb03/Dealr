/**
 * Utility functions for formatting and displaying data
 */

import { M_PROMOTE } from './compactAmount';

/** Format a large count compactly: 0, 1, 42, 1.2k, 15k, 1M. Counts, not currency. */
export const formatStatNumber = (value: number): string => {
  // M_PROMOTE, not 1_000_000: at one decimal, anything from 999,950 up rounds
  // to "1000.0k". Shares the boundary with the currency formatter on purpose.
  if (value >= M_PROMOTE) return `${parseFloat((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${parseFloat((value / 1_000).toFixed(1))}k`;
  return value.toFixed(0);
};

/** Format a currency stat compactly: $0, $42, $1.2k, $15k
 *  @param symbol - currency symbol, defaults to '$'
 */
export const formatStatCurrency = (value: number, symbol = '$'): string => {
  return `${symbol}${formatStatNumber(value)}`;
};

/** Format a date as "Mon YYYY" (e.g., "Jan 2026"). Pass locale from CurrencyContext for locale-aware output. */
export const formatMonthYear = (date: Date, locale = 'en-US'): string => {
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
};

/**
 * Returns color based on net balance value
 * @param netBalance - The player's net balance (positive = profit, negative = loss)
 * @returns Hex color string
 */
export const getNetBalanceColor = (netBalance: number): string => {
  if (netBalance > 0) return '#4CAF50';  // Green for profit
  if (netBalance < 0) return '#C04657';  // Red for loss
  return '#4CAF50';                       // Green for break-even
};

/**
 * Formats net balance for display with +/- prefix
 * Amounts >= 1000 are displayed in "k" format with one decimal place
 * @param netBalance - The player's net balance
 * @param symbol - currency symbol, defaults to '$'
 * @returns Formatted string (e.g., "+$125", "-$50", "+$1.5k", "-$2.0k", "$0")
 */
export const formatNetBalanceDisplay = (netBalance: number, symbol = '$'): string => {
  const absValue = Math.abs(netBalance);

  // Format amounts >= 1000 with "k" suffix and one decimal place
  let formattedValue: string;
  if (absValue >= 1000) {
    const kValue = (absValue / 1000).toFixed(1);
    formattedValue = `${symbol}${kValue}k`;
  } else {
    formattedValue = `${symbol}${absValue.toFixed(0)}`;
  }

  // Add +/- prefix based on sign
  if (netBalance > 0) return `+${formattedValue}`;
  if (netBalance < 0) return `-${formattedValue}`;
  return `${symbol}0`;
};

/**
 * Net balance for display, e.g. "+$125.00", "-$1.5k", "$0.00".
 *
 * `formatCompact` carries the minus itself (it does not call Math.abs), so only
 * '+' is ever prepended here. Prepending '-' as well renders "--$1.5k".
 *
 * The formatter is injected rather than imported: jest-expo/node has no React
 * Native renderer, so anything reaching CurrencyProvider cannot be exercised at
 * all. Same technique as utils/compactAmount.ts.
 */
export const netBalanceDisplay = (
  netBalance: number,
  formatCompact: (n: number) => string,
): string => `${netBalance > 0 ? '+' : ''}${formatCompact(netBalance)}`;
