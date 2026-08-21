/**
 * Arithmetic for the +/- buttons flanking the Buy-in modal's amount field.
 *
 * The field holds a player's CUMULATIVE buy-in total, not a delta — active.tsx
 * seeds it from `balance.totalBuyins` and commits it through
 * `GameService.setPlayerTransactionTotal`. So one tap of `+` means "one more
 * rebuy" and one tap of `-` means "take that rebuy back".
 *
 * Kept pure and separate from the screen so the clamp/round rules can be tested
 * without rendering the modal.
 */

/**
 * Steps a buy-in total string by `step` in `direction`, returning the new field text.
 *
 * - An empty field steps up to exactly `step`, and stays empty on a step down —
 *   active.tsx opens the modal empty because a 0 total is a placeholder, and
 *   handleAddTransaction treats empty as a silent no-op.
 * - Unparseable text counts as 0 (the field is decimal-pad on native, but not on web).
 * - The result is clamped at 0 and rounded to 2dp. Without the rounding, a $12.50
 *   default produces "100.30000000000000004", which `isValidNumericInput` accepts
 *   and the game would then persist.
 */
export function stepBuyInTotal(currentText: string, step: number, direction: 1 | -1): string {
  if (!Number.isFinite(step) || step <= 0) return currentText;

  const trimmed = currentText.trim();
  if (trimmed === '') {
    // '' rather than currentText: a whitespace-only field is functionally empty,
    // and every downstream check (handleAddTransaction, isValidNumericInput)
    // reads it that way. Normalising here keeps the field genuinely empty.
    return direction === 1 ? formatStepResult(step) : '';
  }

  // parseFloat reads the leading numeric prefix, so half-typed text like '50..5'
  // keeps its 50 instead of collapsing to 0. Only text with no leading number
  // at all falls through to 0.
  const parsed = parseFloat(trimmed);
  const base = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

  return formatStepResult(Math.max(0, base + direction * step));
}

/** 2dp is enough for every supported currency: the zero-decimal ones (JPY) round to themselves. */
function formatStepResult(value: number): string {
  return String(Math.round(value * 100) / 100);
}
