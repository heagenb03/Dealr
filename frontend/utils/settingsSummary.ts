/**
 * One-line summary of the active game's settlement settings, shown on the
 * collapsed Settings row. Rounding and tolerance are intentionally dropped
 * while in banker mode before a banker is chosen, to avoid a wordy incomplete
 * state — this mirrors the collapsed row, which suppresses both segments in
 * that state, so the accessibility label and the visible row stay in step.
 */
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
