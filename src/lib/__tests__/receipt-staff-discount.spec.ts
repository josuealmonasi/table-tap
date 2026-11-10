import { expect, it } from "vitest";
import { buildReceipt, type ReceiptOrder } from "@/lib/receipt";

const t = (key: string) => key;
const shop = { name: "Bistro", locale: "en-US", timeZone: "UTC" };

it("a staff discount prints a receipt whose lines add up (journey B, finding 3)", () => {
  // The discount writers lower the total and raise the discount; the subtotal stays as ordered.
  const order = { id: "order", items: [{ itemId: "x", name: "Dinner", price: 100, qty: 1, mods: {} }], subtotal: 100, discount: 20,
    service_fee: 0, tip: 0, total: 80, currency: "MXN", created_at: "2026-11-09T12:00:00Z" } as ReceiptOrder;
  const { text } = buildReceipt([order], shop, t);
  expect(text).toContain("totals.subtotal  MX$100.00");
  expect(text).toContain("totals.discount  −MX$20.00");
  expect(text).not.toContain("MX$120.00");
});

it("a discount taken at checkout prints as before", () => {
  // Checkout saves the subtotal after its discount.
  const order = { id: "order", items: [{ itemId: "x", name: "Dinner", price: 100, qty: 1, mods: {} }], subtotal: 90, discount: 10,
    service_fee: 9, tip: 0, total: 99, currency: "MXN", created_at: "2026-11-09T12:00:00Z" } as ReceiptOrder;
  const { text } = buildReceipt([order], shop, t);
  expect(text).toContain("totals.subtotal  MX$100.00");
  expect(text).toContain("totals.discount  −MX$10.00");
});
