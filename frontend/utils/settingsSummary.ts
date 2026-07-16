/**
 * One-line summary of the active game's settlement settings, shown on the
 * collapsed Settings row. Rounding is intentionally dropped while in banker
 * mode before a banker is chosen, to avoid a wordy incomplete state.
 */
export function formatSettingsSummary(
  isBanker: boolean,
  bankerName: string | undefined,
  roundingLabel: string,
): string {
  if (!isBanker) return `Direct · ${roundingLabel}`;
  if (!bankerName) return 'Banker · Choose banker';
  return `Banker · ${bankerName} · ${roundingLabel}`;
}
