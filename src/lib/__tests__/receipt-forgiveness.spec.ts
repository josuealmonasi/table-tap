import { describe, expect, it } from "vitest";
import { buildReceipt, type ReceiptOrder } from "@/lib/receipt";
import { messagesFor, translate } from "@/lib/i18n";

const order: ReceiptOrder = {
  id: "order", items: [{ itemId: "meal", name: "Dinner", emoji: "", price: 100, qty: 1, mods: {} }], subtotal: 90, discount: 10,
  total: 70, tip: 5, service_fee: 5, currency: "MXN", created_at: "2026-10-27T18:00:00Z",
  forgiveness: { id: "adjustment", previous_total: 110, resulting_total: 70, forgiven: 40,
    previous_tip: 10, resulting_tip: 5, previous_service_fee: 10, resulting_service_fee: 5 },
};
describe.each(["en", "es"] as const)("forgiven bill in %s", locale => {
  it("explains the same original, discount, service, tip, loss and paid arithmetic in email and paper", () => {
    const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor(locale), key, vars);
    const receipt = buildReceipt([order], { name: "Bistro", timeZone: "America/Mexico_City", locale }, t);
    const expected = [["totals.subtotal", "MX$100.00"], ["totals.discount", "−MX$10.00"], ["receipt.service", "MX$10.00"],
      ["totals.tip", "MX$10.00"], ["receipt.originalBill", "MX$110.00"], ["receipt.forgiven", "−MX$40.00"], ["receipt.paid", "MX$70.00"]];
    for (const [key, amount] of expected) {
      expect(receipt.text).toContain(`${t(key)}  ${amount}`);
      expect(receipt.html).toContain(t(key)); expect(receipt.html).toContain(amount);
    }
    expect(receipt.text).toContain(locale === "es" ? "Perdonado por el restaurante" : "Forgiven by the restaurant");
  });
});
it("rounds each original bill before adding, so a table's losses add back to the original", () => {
  const small = (id: string, previous: string, resulting: number, forgiven: number): ReceiptOrder => ({ ...order, id,
    subtotal: previous, total: resulting, service_fee: 0, tip: 0,
    forgiveness: { ...order.forgiveness!, previous_total: previous, resulting_total: resulting, forgiven,
      previous_service_fee: 0, resulting_service_fee: 0, previous_tip: 0, resulting_tip: 0 } });
  const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor("en"), key, vars);
  const receipt = buildReceipt([small("first", "1.005", 1, 0.01), small("second", "2.675", 2, 0.68)],
    { name: "Bistro", locale: "en", timeZone: "America/Mexico_City" }, t);
  expect(receipt.text).toContain("Original bill  MX$3.69"); expect(receipt.text).toContain("−MX$0.69"); expect(receipt.text).toContain("Paid  MX$3.00");
});
