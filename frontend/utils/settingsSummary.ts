/**
 * One-line summary of the active game's settlement settings, shown on the
 * collapsed Settings row. Rounding is intentionally dropped while in banker
 * mode before a banker is chosen, to avoid a wordy incomplete state.
 */
export function formatSettingsSummary(
  isBanker: boolean,
  bankerName: string | undefined,
  roundingLabel: string,
  toleranceLabel?: string,
): string {
  const tol = toleranceLabel ? ` · ${toleranceLabel}` : '';
  if (!isBanker) return `Direct · ${roundingLabel}${tol}`;
  if (!bankerName) return `Banker · Choose banker${tol}`;
  return `Banker · ${bankerName} · ${roundingLabel}${tol}`;
}
