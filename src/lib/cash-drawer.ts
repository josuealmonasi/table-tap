import { round2 } from "@/lib/money";
import { typedDecimal } from "@/lib/typed-decimal";

/**
 * Cash taken out of the drawer, and how an amount of cash is read as typed.
 * What the drawer should hold is worked out per shift: see cash-shift.ts.
 *
 * Pure.
 */

export const MAX_CASH_AMOUNT = 1_000_000;

/** A row of `cash_movements`. */
export interface CashMovement {
  id: string;
  currency: string;
  kind: "opening" | "withdrawal";
  amount: number;
  note: string | null;
  actor_email: string;
  created_at: string;
}

/**
 * A typed amount of cash, or null when it is not one. Accepts "250", "250.5",
 * "1,250.00" and a decimal comma, "12,50"; refuses a negative, more than two
 * decimals, or more than any drawer holds. A withdrawal of nothing is not one,
 * so `positive` refuses 0.
 */
export function cashAmount(raw: unknown, positive: boolean): number | null {
  const amount = typedDecimal(raw, 2);
  if (amount === null || amount > MAX_CASH_AMOUNT) return null;
  if (positive && amount <= 0) return null;
  return round2(amount);
}

/** A withdrawal's reason: trimmed, at most 140 characters, or nothing. */
export function cashNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const note = raw.trim().slice(0, 140);
  return note || null;
}
