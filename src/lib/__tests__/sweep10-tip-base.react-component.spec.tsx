import { expect, it } from "vitest";
import { billAmounts } from "@/lib/bill-amounts";
import { tableBill } from "@/lib/table-bill";
import { priceCart } from "@/lib/pricing";
import type { Order } from "@/lib/types";

it("F6 tips the same food at checkout and bill settlement, excluding service and old tips", () => {
  const cart = priceCart({ items: [{ itemId: "food", name: "Food", emoji: "", price: 100, qty: 1, mods: {} }],
    servicePct: 10, serviceEnabled: true, tipPct: 10 });
  const order = { id: "food", subtotal: cart.subtotal, total: cart.total, service_fee: cart.serviceFee,
    tip: cart.tip, tax_pct: 16, currency: "MXN", status: "received", paid: false, discount: 0, items: [] } as unknown as Order;
  expect(billAmounts(tableBill([order], []), "all", null, 10, null).tip).toBe(cart.tip);
});
