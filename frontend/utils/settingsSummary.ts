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
 * One-line summary of the active game's settlement settings, spoken as the
 * collapsed Settings row's accessibility label. Segments are ordered
 * most-changed to least-changed: mode, buy-in, rounding, tolerance. Every
 * segment is always emitted — including while banker mode has no banker
 * chosen, a state that has been persistent since 2026-08-07 and can last a
 * whole game, so hiding a host's rounding and tolerance for its duration is
 * worse than a longer label.
 *
 * The parameter order deliberately does NOT match the emitted order: the
 * optional labels stay last so the required `roundingLabel` keeps its
 * position. There is one production call site.
 *
 * Two deliberate divergences from the visible row, both because a screen
 * reader gets no icon to disambiguate a bare value:
 *  - The row drops the "Banker · " prefix (the person icon carries it) and
 *    shows the bare name; the label keeps the prefix.
 *  - The row shows the shorter "Set banker" placeholder, which is the only
 *    wording that fits an iPhone SE; the label says "Choose banker".
 * This mirrors the existing buyInValueLabel / buyInSummaryLabel split in
 * active.tsx, where the row renders a bare "$20" and the label says
 * "Buy-in $20".
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
  return `Banker · ${bankerName ?? 'Choose banker'}${buyIn} · ${roundingLabel}${tol}`;
}
