/**
 * One-line summary of the active game's settlement settings, shown on the
 * collapsed Settings row. Rounding and tolerance are intentionally dropped
 * while in banker mode before a banker is chosen, to avoid a wordy incomplete
 * state — this mirrors the collapsed row, which suppresses both segments in
 * that state, so the accessibility label and the visible row stay in step.
 */
/**
 * Caption for a resolved imbalance tolerance, shown in both the collapsed
 * Settings row and its accessibility label. Always produces a segment — even at
 * the currency default — so tolerance reads consistently with rounding rather
 * than silently vanishing at the default. Exact (0) means "no tolerance", so it
 * reads "Exact" instead of "±$0".
 */
export function toleranceCaption(
  resolvedTolerance: number,
  formatAmount: (n: number) => string,
): string {
  return resolvedTolerance === 0 ? 'Exact' : `±${formatAmount(resolvedTolerance)}`;
}

export function formatSettingsSummary(
  isBanker: boolean,
  bankerName: string | undefined,
  roundingLabel: string,
  toleranceLabel?: string,
): string {
  const tol = toleranceLabel ? ` · ${toleranceLabel}` : '';
  if (!isBanker) return `Direct · ${roundingLabel}${tol}`;
  if (!bankerName) return `Banker · Choose banker`;
  return `Banker · ${bankerName} · ${roundingLabel}${tol}`;
}
