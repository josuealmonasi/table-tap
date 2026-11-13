// ============================================================================
// "IVA 16% incluido" on the ticket (owner's decision, 2026-11-12: "do as a
// Mexican ticket does"). Sales to the general public in Mexico are priced
// with IVA inside (LIVA), and a till's ticket prints the total and then the
// IVA it contains. The rate is the one the restaurant declared in Settings →
// Impuesto, as each order snapshotted it (`orders.tax_pct`); 0 prints no line.
// The amount is worked out with `withoutIva`, the function Costs uses, so the
// ticket and Costs never disagree about the same sale.
//
// Client-safe: receiptModel carries the parts from saleVatParts, and
// ticket-pdf.ts prints one line per rate.
// ============================================================================
import { round2, withoutIva } from "@/lib/money";
import { receiptCents as cents } from "@/lib/receipt-amount";
import type { ReceiptOrder, SlotReceiptPayment } from "@/lib/receipt";

/** The sale at one IVA rate: what the IVA line for that rate is worked out from. */
export interface VatPart { rate: number; base: number }

const isRate = (rate: unknown): rate is number =>
  typeof rate === "number" && Number.isFinite(rate) && rate >= 0 && rate <= 100;

/**
 * The IVA contained in `base` at `rate` percent, or null when no line is
 * printed: a rate of 0 (the restaurant declared none) or nothing sold.
 * 16 % of a MX$116.00 base is MX$16.00.
 */
export function includedVat(base: number, rate: number): number | null {
  if (!Number.isFinite(base) || base <= 0 || !isRate(rate) || rate === 0) return null;
  return round2(base - withoutIva(base, rate));
}

/**
 * What the ticket's total holds that IVA is part of, per rate: the food and
 * charges as charged, after every discount, without the tip — a tip is not
 * part of the sale and carries no IVA. Read from the same values the TOTAL
 * row prints, so the lines under it always speak of that number.
 *
 * Orders: each order's total less its own tip, as this copy of the ticket
 * keeps them (after a forgiveness or a return, the amounts it retained),
 * grouped by the rate that order was sold at. A table whose orders were sold
 * at two rates gets one line per rate.
 *
 * A paid split part: its own amount less its own tip, at the rate its split's
 * orders share. A part is a share of the table's frozen debt, and that debt
 * can carry tips added to the orders before the split; no ticket can say how
 * much of a part is such a tip, nor which rate a part of a mixed-rate table
 * was, so a part prints IVA only when the split's debt carried no tips
 * (`parts_without_tips`) and its orders share one rate (`tax_pct`).
 *
 * Null — no line — whenever the base is not known for certain: a wrong IVA
 * amount is worse than none.
 */
export function saleVatParts(orders: ReceiptOrder[], payment?: SlotReceiptPayment): VatPart[] | null {
  if (payment) {
    if (payment.parts_without_tips !== true || !isRate(payment.tax_pct)) return null;
    const kept = cents(payment.amount) - cents(payment.return_components?.total ?? 0);
    const tip = cents(payment.tip) - cents(payment.return_components?.tip ?? 0);
    return known(kept, tip) ? [{ rate: payment.tax_pct, base: (kept - tip) / 100 }] : null;
  }
  if (orders.length === 0) return null;
  const byRate = new Map<number, number>();
  for (const o of orders) {
    const rate = o.tax_pct == null ? NaN : Number(o.tax_pct);
    const total = cents(o.total), tip = cents(o.tip ?? 0);
    if (!isRate(rate) || !known(total, tip)) return null;
    byRate.set(rate, (byRate.get(rate) ?? 0) + total - tip);
  }
  return [...byRate].sort(([a], [b]) => b - a).map(([rate, base]) => ({ rate, base: base / 100 }));
}

const known = (total: number, tip: number): boolean =>
  Number.isSafeInteger(total) && Number.isSafeInteger(tip) && tip >= 0 && tip <= total;
