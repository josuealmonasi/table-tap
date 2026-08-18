import { describe, expect, it } from "vitest";
import { buildReceipt, type ReceiptOrder } from "@/lib/receipt";
import { messagesFor, translate } from "@/lib/i18n";

const es = messagesFor("es");
const PLACE = { name: "Demo Bistro", timeZone: "America/Mexico_City", locale: "es-MX" };
const t = (key: string, vars?: Record<string, string | number>) =>
  translate(es, key, vars);

function order(over: Partial<ReceiptOrder> = {}): ReceiptOrder {
  return {
    id: "1960abcd-1234-4567-89ab-cdef01234567",
    items: [{ itemId: "a", name: "Tonkotsu Ramen", emoji: "🍜", price: 13, qty: 2, mods: {} }],
    subtotal: 26,
    discount: 0,
    service_fee: 0,
    tip: 0,
    total: 26,
    currency: "MXN",
    table_label: "6",
    created_at: "2026-08-18T20:00:00Z",
    ...over,
  };
}

describe("the receipt a diner asked for", () => {
  it("lists what they ate and what they paid", () => {
    const r = buildReceipt([order()], PLACE, t);
    expect(r.text).toContain("2× Tonkotsu Ramen");
    expect(r.text).toContain("MX$26.00");
    expect(r.subject).toContain("Demo Bistro");
    expect(r.subject).toContain("ORD-1960");
  });

  it("shows what a promotion took off, the way the bill did", () => {
    // The lines add up to more than the total; without the discount row the
    // receipt is the arithmetic nobody can follow.
    const r = buildReceipt([order({ subtotal: 21, discount: 5, total: 21 })], PLACE, t);
    expect(r.text).toContain("Descuento");
    expect(r.text).toContain("−MX$5.00");
  });

  it("adds up a whole table settled at once", () => {
    const r = buildReceipt(
      [
        order({ total: 26 }),
        order({
          id: "2b71abcd-1234-4567-89ab-cdef01234567",
          items: [{ itemId: "b", name: "Green Tea", emoji: "🍵", price: 3, qty: 1, mods: {} }],
          subtotal: 3,
          total: 3,
        }),
      ],
      PLACE,
      t,
    );
    expect(r.text).toContain("2× Tonkotsu Ramen");
    expect(r.text).toContain("1× Green Tea");
    expect(r.text).toContain("MX$29.00");
  });

  it("keeps the tip and the service charge separate from the food", () => {
    const r = buildReceipt(
      [order({ service_fee: 2.6, tip: 5, total: 33.6 })],
      PLACE,
      t,
    );
    expect(r.text).toContain("Servicio");
    expect(r.text).toContain("Propina");
    expect(r.text).toContain("MX$33.60");
  });

  it("stamps the restaurant's own clock, not the server's", () => {
    // 02:00 UTC is still the previous evening in Mexico City. A receipt that
    // dates dinner to the small hours of the next day is a receipt nobody can
    // match to their card statement.
    const r = buildReceipt([order({ created_at: "2026-08-19T02:00:00Z" })], PLACE, t);
    expect(r.text).toContain("18 de agosto de 2026");
    expect(r.text).toMatch(/08:00\s*p\.?\s?m\.?/);
  });

  it("escapes a restaurant name that contains markup", () => {
    // The name comes from a text field somebody else controls.
    const r = buildReceipt([order()], { ...PLACE, name: "<script>alert(1)</script>" }, t);
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("says why it arrived and promises nothing else will", () => {
    const r = buildReceipt([order()], PLACE, t);
    expect(r.text).toContain("porque lo pediste");
  });
});
