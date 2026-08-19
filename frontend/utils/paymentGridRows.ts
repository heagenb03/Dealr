/**
 * Row/slot layout for the settlement card's expanded "FROM (N PLAYERS)" grid.
 *
 * Why this exists as data instead of inline JSX: the grid used to be one wrapping
 * flex row that decided divider placement with `index % columns !== 0`. That rule
 * only holds if `columns` cells actually fit on one visual line, and they did not —
 * three cells at `width: '33.333%'` consume the whole container, so the two 17pt
 * dividers between them overflowed it and Yoga wrapped the third cell away. From
 * that point `index % columns` described rows that no longer existed and divider
 * placement drifted out of phase with the layout.
 *
 * Chunking here makes "first cell of a visual row" a fact the caller is handed
 * rather than an inference it has to re-derive, so that drift is not expressible.
 *
 * Every returned row has IDENTICAL structure — exactly `columns` box slots (cells,
 * trailing ones padded with spacers) interleaved with `columns - 1` divider slots,
 * visible only where a real cell follows. Uniform structure is what keeps columns
 * aligned across rows: a final row holding one payment still carries the same slot
 * widths as the full rows above it.
 *
 * No react-native import — jest-expo/node has no RN renderer.
 */

/** Cells per visual row. Single source of truth; the grid styles assume nothing. */
export const PAYMENT_GRID_COLUMNS = 3;

export interface PaymentGridPayment {
  from: string;
  amount: number;
}

export type PaymentGridSlot =
  /** A real payment. */
  | { kind: 'cell'; payment: PaymentGridPayment }
  /** Empty column holding the grid's shape in a partially filled last row. */
  | { kind: 'spacer' }
  /**
   * The gap between two columns. `visible: false` still occupies its width, so a
   * short last row keeps the same column positions as the rows above it.
   */
  | { kind: 'divider'; visible: boolean };

/**
 * Chunk `payments` into fixed-width rows of grid slots.
 *
 * @param columns cells per row; values below 1 are treated as a single column.
 */
export function buildPaymentGridRows(
  payments: readonly PaymentGridPayment[],
  columns: number = PAYMENT_GRID_COLUMNS,
): PaymentGridSlot[][] {
  const perRow = Math.max(1, Math.floor(columns));
  const rows: PaymentGridSlot[][] = [];

  for (let start = 0; start < payments.length; start += perRow) {
    const row: PaymentGridSlot[] = [];

    for (let column = 0; column < perRow; column++) {
      const payment = payments[start + column];

      if (column > 0) {
        // The rule is drawn only when there is a real cell to its right; the
        // trailing gaps in a short row are invisible but still take up space.
        row.push({ kind: 'divider', visible: payment !== undefined });
      }

      row.push(payment !== undefined ? { kind: 'cell', payment } : { kind: 'spacer' });
    }

    rows.push(row);
  }

  return rows;
}
