// ============================================================================
// "IVA 16% incluido" on the ticket (owner's decision, 2026-11-12: "do as a
// Mexican ticket does"). Sales to the general public in Mexico are priced
// with IVA inside (LIVA), and a till's ticket prints the total and then the
// IVA it contains. The owner picks the rate: 16 % (general), 8 % (the border
// region's tax incentive) or 0, which prints no line at all.
//
// Client-safe: the settings card lists the rates, receiptModel carries the
// base from saleVatBase, and ticket-pdf.ts prints the line.
// ============================================================================
import { ivaSplit, round2 } from "@/lib/money";
import { receiptCents as cents } from "@/lib/receipt-amount";
import type { ReceiptOrder, SlotReceiptPayment } from "@/lib/receipt";

export const TICKET_VAT_RATES = [16, 8, 0] as const;
export type TicketVatRate = (typeof TICKET_VAT_RATES)[number];
export const DEFAULT_TICKET_VAT_RATE: TicketVatRate = 16;

export function isTicketVatRate(value: unknown): value is TicketVatRate {
  return typeof value === "number" && (TICKET_VAT_RATES as readonly number[]).includes(value);
}

/**
 * The IVA contained in `base` at `rate` percent, or null when the ticket
 * prints no IVA line: the owner chose 0, or the base is unknown (see
 * `saleVatBase` below), or nothing taxable was sold.
 * 16 % of a MX$116.00 base is MX$16.00.
 */
export function includedVat(base: number | null, rate: number | null | undefined): number | null {
  if (base === null || !Number.isFinite(base) || base <= 0) return null;
  if (!isTicketVatRate(rate) || rate === 0) return null;
  return round2(ivaSplit(base, rate).iva);
}

/**
 * What the ticket's total holds that IVA is part of: the food and charges
 * as charged, after every discount, without the tip — a tip is not part of
 * the sale and carries no IVA. Read from the same values the TOTAL row
 * prints, so the line under it always speaks of that number.
 *
 * Orders: each order's total less its own tip, as this copy of the ticket
 * keeps them (after a forgiveness or a return, the amounts it retained).
 *
 * A paid split part: its own amount less its own tip. A part is a share of
 * the table's frozen debt, and that debt can carry tips added to the orders
 * before the split; no ticket can say how much of a part is such a tip, so a
 * part prints IVA only when the split's debt carried none
 * (`parts_without_tips`, read from the split). Null — no line — whenever the
 * base is not known for certain: a wrong IVA amount is worse than none.
 */
export function saleVatBase(orders: ReceiptOrder[], payment?: SlotReceiptPayment): number | null {
  if (payment) {
    if (payment.parts_without_tips !== true) return null;
    const kept = cents(payment.amount) - cents(payment.return_components?.total ?? 0);
    const tip = cents(payment.tip) - cents(payment.return_components?.tip ?? 0);
    return known(kept, tip) ? (kept - tip) / 100 : null;
  }
  if (orders.length === 0) return null;
  let base = 0;
  for (const o of orders) {
    const total = cents(o.total), tip = cents(o.tip ?? 0);
    if (!known(total, tip)) return null;
    base += total - tip;
  }
  return base / 100;
}

const known = (total: number, tip: number): boolean =>
  Number.isSafeInteger(total) && Number.isSafeInteger(tip) && tip >= 0 && tip <= total;
