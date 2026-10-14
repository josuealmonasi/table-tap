import { round2 } from "@/lib/money";
import { corteFrom, type CorteAdjustment, type CortePayment } from "@/lib/corte";
import type { CashMovement } from "@/lib/cash-drawer";

/**
 * A shift at the cash drawer, and what it should hold.
 *
 * Asked for by a café: open and close per shift, the counted cash entered
 * before the expected amount is revealed, a difference explained, the person
 * closing signing it off, and a trail of what happened to the money.
 *
 * What the drawer should hold is the opening, plus the cash taken during the
 * shift (net of cash handed back, exactly as the corte counts it), minus what
 * was taken out. Card and online money never sits in the drawer.
 *
 * Pure. The rows come from `cash_shifts`, `payments`, the activity log and
 * `cash_movements`.
 */

/** A row of `cash_shifts`. */
export interface CashShift {
  id: string;
  opened_by: string;
  opened_at: string;
  opening_amount: number;
  closed_by: string | null;
  closed_at: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  difference_note: string | null;
  explained_by: string | null;
}

/** A line of a shift's trail: what happened to the money, by whom, when. */
export interface TrailLine {
  entity: string;
  action: string;
  detail: string | null;
  actor_email: string | null;
  created_at: string;
}

/** A shift as the screens show it: its sum, its withdrawals, its trail. */
export interface ShiftView {
  shift: CashShift;
  sum: ShiftSum;
  withdrawals: CashMovement[];
  trail: TrailLine[];
}

/** What the drawer holds during a shift, as the sum a person counts against. */
export interface ShiftSum {
  opening: number;
  /** Cash taken in the shift, net of cash handed back. */
  cashSales: number;
  withdrawn: number;
  expected: number;
}

/** The shift's sum from the rows inside its window. */
export function shiftSum(
  opening: number,
  payments: CortePayment[],
  adjustments: CorteAdjustment[],
  withdrawals: Pick<CashMovement, "amount">[],
): ShiftSum {
  const cashSales = corteFrom(payments, adjustments).totals.cash;
  const withdrawn = round2(withdrawals.reduce((sum, w) => sum + Number(w.amount), 0));
  const open = round2(Number(opening));
  return { opening: open, cashSales, withdrawn, expected: round2(open + cashSales - withdrawn) };
}

/**
 * Counted minus expected: positive is cash over, negative is cash short.
 * A cent either way is still a difference; rounding to it keeps 0.1 + 0.2
 * from reading as a shortfall.
 */
export function shiftDifference(counted: number, expected: number): number {
  const difference = round2(counted - expected);
  // -0 is a count that matched, and must never print as "−MX$0.00".
  return difference === 0 ? 0 : difference;
}

/** Whether a closed shift still owes an explanation for its difference. */
export function needsExplanation(shift: CashShift): boolean {
  return shift.closed_at !== null && Math.abs(Number(shift.difference ?? 0)) >= 0.01 && !shift.difference_note;
}

/** A shift's explanation: trimmed, at most 280 characters, or nothing. */
export function shiftNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const note = raw.trim().slice(0, 280);
  return note || null;
}
