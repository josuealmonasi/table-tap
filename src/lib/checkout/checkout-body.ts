import type { OrderLineItem } from "@/lib/types";

/** What the menu sends to `/api/checkout`. Nothing in it is trusted as-is. */
export interface CheckoutBody {
  restaurantId: string;
  tableId: string | null;
  tableLabel: string | null;
  items: OrderLineItem[];
  note?: string;
  /** Only sent from the general QR: at a table, the table is the name. */
  customerName?: string;
  tipPct?: number;
  tipAmount?: number;
  couponCode?: string;
  /** Dine-in: send the food now and settle at the end. */
  payLater?: boolean;
  /**
   * The throwaway id this phone gave itself for the evening.
   *
   * Stored on the order so a table can be divided between the people who
   * actually ate: the number of devices that have ordered on the sitting
   * is the most ways its bill can go. Absent from a waiter's order, and
   * from a phone with storage switched off.
   */
  diner?: string;
}

/**
 * The tip the diner chose: a preset percentage (recomputed from the verified
 * subtotal) or an exact "Other" amount. Anything else is no tip. An exact
 * amount is capped at the subtotal later, by `priceCart`, once that is known.
 */
export function checkoutTip(body: Pick<CheckoutBody, "tipPct" | "tipAmount">): {
  tipPct: number;
  tipAmount: number | null;
} {
  const { tipPct: rawTipPct, tipAmount: rawTipAmount } = body;
  const tipPct = [0, 10, 15, 20].includes(rawTipPct ?? 0) ? (rawTipPct ?? 0) : 0;
  const tipAmount =
    Number.isFinite(rawTipAmount) && (rawTipAmount as number) > 0
      ? +(rawTipAmount as number).toFixed(2)
      : null;
  return { tipPct, tipAmount };
}
