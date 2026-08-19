import type { Order } from "@/lib/types";

/**
 * Cancelling what a table owes.
 *
 * Every write-off names a reason, because the alternative is a month-end where
 * the takings are short and nothing says why. The reasons are a fixed list so
 * they can be counted — "we lost MX$3,400 to walkouts this month" is a number
 * an owner can act on, where a column of free text is not — with a note beside
 * it for the part no list can predict.
 *
 * Pure: the dialog offering the reasons and the endpoint accepting them agree
 * because they read the same list.
 */

export const WRITE_OFF_REASONS = ["walkout", "comp", "error", "other"] as const;
export type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];

/** Free text beside the reason. Long enough to explain, short enough to read. */
export const NOTE_MAX = 300;

export function isWriteOffReason(value: unknown): value is WriteOffReason {
  return typeof value === "string" && (WRITE_OFF_REASONS as readonly string[]).includes(value);
}

/**
 * "Other" is the only reason that cannot stand alone: picking it says nothing
 * on its own, and a write-off nobody can explain later is the thing this
 * whole record exists to prevent.
 */
export function noteRequired(reason: WriteOffReason): boolean {
  return reason === "other";
}

export function noteProblem(reason: WriteOffReason, note: string): "missing" | "tooLong" | null {
  const trimmed = note.trim();
  if (noteRequired(reason) && trimmed.length === 0) return "missing";
  if (trimmed.length > NOTE_MAX) return "tooLong";
  return null;
}

/**
 * The orders a write-off would actually cancel.
 *
 * Only what is still owed: an order already paid for needs a refund, which is
 * a different act with its own record, and one already written off would be
 * cancelled twice — doubling what the reports say the restaurant lost.
 */
export function writableOff(orders: Order[]): Order[] {
  return orders.filter(
    o => !o.paid && !o.written_off && o.status !== "cancelled" && o.status !== "pending_payment",
  );
}

/** What cancelling these costs the restaurant. */
export function writeOffTotal(orders: Order[]): number {
  return Math.round(orders.reduce((sum, o) => sum + Number(o.total), 0) * 100) / 100;
}
