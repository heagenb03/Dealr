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

/**
 * One-line summary of the active game's settlement settings, shown on the
 * collapsed Settings row. Segments are ordered most-changed to least-changed:
 * mode, buy-in, rounding, tolerance. Rounding, tolerance and the default
 * buy-in are intentionally dropped while in banker mode before a banker is
 * chosen, to avoid a wordy incomplete state — this mirrors the collapsed row,
 * which suppresses all three segments in that state, so the accessibility
 * label and the visible row stay in step.
 *
 * The parameter order deliberately does NOT match the emitted order: the
 * optional labels stay last so the required `roundingLabel` keeps its
 * position. There is one production call site.
 *
 * The buy-in label is spoken as "Buy-in $20" while the row renders a bare
 * "$20" beside a cash icon. This asymmetry is deliberate: a screen reader gets
 * no icon, and a bare "$20" preceding the bare "$5" announced for rounding
 * would be indistinguishable.
 */
export function formatSettingsSummary(
  isBanker: boolean,
  bankerName: string | undefined,
  roundingLabel: string,
  toleranceLabel?: string,
  buyInLabel?: string,
): string {
  const tol = toleranceLabel ? ` · ${toleranceLabel}` : '';
  const buyIn = buyInLabel ? ` · ${buyInLabel}` : '';
  if (!isBanker) return `Direct${buyIn} · ${roundingLabel}${tol}`;
  if (!bankerName) return `Banker · Choose banker`;
  return `Banker · ${bankerName}${buyIn} · ${roundingLabel}${tol}`;
}
