import { receiptCents } from "@/lib/receipt-amount";

export function validCreditCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2147483647;
}

/** Reject extra decimals instead of silently changing the manager's credit. */
export function creditPreview(input: string, orderTotal: number, accountOwed: number): {
  amountCents: number; expectedCents: number; remainingCents: number; balanceCents: number;
} | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(input.trim())) return null;
  const amountCents = receiptCents(input.trim()), expectedCents = receiptCents(orderTotal);
  if (!validCreditCents(amountCents) || amountCents > expectedCents) return null;
  return { amountCents, expectedCents, remainingCents: expectedCents - amountCents,
    balanceCents: receiptCents(accountOwed) - amountCents };
}
