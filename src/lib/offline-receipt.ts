import { buildReceipt } from "@/lib/receipt";
import type { OrderLineItem } from "@/lib/types";

/**
 * The receipt for a sale rung without a connection, built in the browser
 * from the same function the server builds every receipt with — so a ticket
 * printed during an outage reads exactly like any other. Its code comes from
 * the sale's own reference, which becomes its id when it is sent: the code on
 * the paper is the code the sale has.
 *
 * Pure.
 */
export function offlineReceipt(
  sale: {
    posRef: string;
    at: string;
    lines: OrderLineItem[];
    charge: { subtotal: number; serviceFee: number; tip: number; discount: number; total: number };
    method: "cash" | "card";
    currency: string;
  },
  place: { name: string; timeZone: string; locale: string },
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  return buildReceipt(
    [{
      id: sale.posRef, items: sale.lines, subtotal: sale.charge.subtotal, service_fee: sale.charge.serviceFee,
      tip: sale.charge.tip, discount: sale.charge.discount, total: sale.charge.total, currency: sale.currency,
      created_at: sale.at, pay_method: sale.method,
    }],
    place,
    t,
  ).html;
}
