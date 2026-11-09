import { cashAmount } from "@/lib/cash-drawer";

/** Refunds can exceed today's sales: a bank debit is money leaving, not zero. */
export function bankAmount(raw: unknown): number | null {
  const text = typeof raw === "number" || typeof raw === "string" ? String(raw).trim() : "";
  const negative = text.startsWith("-");
  const amount = cashAmount(negative ? text.slice(1) : text, false);
  return amount === null ? null : negative ? -amount : amount;
}
