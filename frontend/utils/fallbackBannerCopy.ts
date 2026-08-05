/**
 * Copy for the summary fallback banner. Extracted as a pure function so the
 * message logic is unit-testable without rendering the component.
 *
 * - isRetrying: a server retry is in flight.
 * - timedOut: our own request budget expired (SOLVER_TIMEOUT_SENTINEL). The server
 *   WAS reached, so this must never render the unreachable-server wording.
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
  timedOut: boolean = false,
): string {
  if (isRetrying) return 'Optimizing settlements...';
  // Gated on `retryable` so this is unreachable on an out-of-tolerance table.
  // isRetryableFallback returns false above tolerance, which is exactly what makes
  // "these settlements are correct" safe to assert here: the greedy fallback only
  // strands money when the totals do not balance, and that case falls through to
  // the imbalance message below.
  if (timedOut && retryable) {
    return 'Optimizing took too long. These settlements are correct, just possibly not the fewest payments.';
  }
  if (retryable) return "Couldn't reach server. Settlements are non-optimized";
  if (netDifference > tolerance) {
    return `Totals are off by ${formatAmount(netDifference)}, over your ${formatAmount(
      tolerance,
    )} limit. These settlements are a best-effort estimate.`;
  }
  return "Couldn't optimize these settlements. They're a best-effort estimate.";
}
