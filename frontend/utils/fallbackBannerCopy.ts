/**
 * Copy for the summary fallback banner. Extracted as a pure function so the
 * message logic is unit-testable without rendering the component.
 *
 * - isRetrying: a server retry is in flight.
 * - retryable: the server was unreachable but the local data is fine — a retry
 *   may help (network case).
 * - otherwise: non-retryable. When the imbalance is the cause
 *   (netDifference > tolerance) name the numbers; otherwise stay generic so a
 *   non-imbalance rejection never renders a contradictory "off by $0" line.
 *
 * netDifference = |Σ totalBuyins − Σ totalCashouts|.
 */
export function fallbackBannerCopy(
  retryable: boolean,
  isRetrying: boolean,
  netDifference: number,
  tolerance: number,
  formatAmount: (n: number) => string,
): string {
  if (isRetrying) return 'Optimizing settlements...';
  if (retryable) return "Couldn't reach server. Settlements are non-optimized";
  if (netDifference > tolerance) {
    return `Totals are off by ${formatAmount(netDifference)}, over your ${formatAmount(
      tolerance,
    )} limit. These settlements are a best-effort estimate.`;
  }
  return "Couldn't optimize these settlements. They're a best-effort estimate.";
}
