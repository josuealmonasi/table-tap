import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { receiptModel, type ReceiptOrder, type SlotReceiptPayment } from "@/lib/receipt";
import { messagesFor, translate } from "@/lib/i18n";
import { includedVat } from "@/lib/ticket-vat";
import { periodContribution } from "@/lib/costs/margins";
import { round2 } from "@/lib/money";

// "IVA 16% incluido" under the ticket's total (owner's decision, 2026-11-12).
const PLACE = { name: "Demo Bistro", timeZone: "America/Mexico_City", locale: "es-MX" };
const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars);

function order(over: Partial<ReceiptOrder> = {}): ReceiptOrder {
  return {
    id: "1960abcd-1234-4567-89ab-cdef01234567",
    items: [{ itemId: "a", name: "Tacos", emoji: "🌮", price: 58, qty: 2, mods: {} }],
    tax_pct: 16, subtotal: 116, discount: 0, service_fee: 0, tip: 0, total: 116,
    currency: "MXN", table_label: "6", created_at: "2026-11-12T20:00:00Z",
    ...over,
  };
}
function part(over: Partial<SlotReceiptPayment> = {}): SlotReceiptPayment {
  return { id: "5a1e0000-0000-4000-8000-000000000000", amount: 126, tip: 10, currency: "MXN",
    created_at: "2026-11-12T20:00:00Z", slots: [0], parts_without_tips: true, tax_pct: 16, ...over };
}
/** The IVA line for the rate saved on these orders or this paid part. */
function vatOf(orders: ReceiptOrder[], rate: number, payment?: SlotReceiptPayment): number | null {
  const part = receiptModel(orders, PLACE, t, payment).vatParts?.find(part => part.rate === rate);
  return part ? includedVat(part.base, part.rate) : null;
}

describe("the IVA amount", () => {
  it("is what the base contains at the order's rate", () => {
    expect(includedVat(116, 16)).toBe(16);
    expect(includedVat(108, 8)).toBe(8);
    expect(includedVat(100, 16)).toBe(13.79);
  });

  it("is not printed at 0, at an invalid rate, or with nothing sold", () => {
    expect(includedVat(116, 0)).toBeNull();
    expect(includedVat(116, -1)).toBeNull();
    expect(includedVat(116, 101)).toBeNull();
    expect(includedVat(116, NaN)).toBeNull();
    expect(includedVat(0, 16)).toBeNull();
    expect(includedVat(NaN, 16)).toBeNull();
  });

  it("uses the same inclusive tax calculation as Costs for any saved rate", () => {
    expect(includedVat(112, 12)).toBe(12);
    expect(includedVat(108, 8)).toBe(8);
  });

  it.each([16, 8])("agrees with Costs about the same order at %s %%", rate => {
    // One MX$116.00 dish, a MX$10.00 tip: Costs counts the dish's revenue
    // without IVA, the ticket prints the IVA it took off. They must add back up.
    const sold = order({ tax_pct: rate, tip: 10, total: 126,
      items: [{ itemId: "a", name: "Tacos", emoji: "🌮", price: 116, qty: 1, mods: {} }] });
    const costs = periodContribution([{ ...sold, items: sold.items!, total: 126, service_fee: 0, tip: 10, tax_pct: rate }], 0);
    const ticket = receiptModel([sold], PLACE, t).vatParts!;
    expect(ticket).toEqual([{ rate, base: 116 }]);
    expect(includedVat(ticket[0].base, rate)).toBe(round2(116 - costs.rows[0].revenue));
  });
});

describe("what the IVA is included in", () => {
  it("is the sale on a plain ticket: MX$116.00 at 16 % holds MX$16.00", () => {
    expect(vatOf([order()], 16)).toBe(16);
    expect(vatOf([order({ tax_pct: 8, subtotal: 108, total: 108 })], 8)).toBe(8);
    expect(vatOf([order({ tax_pct: 0 })], 0)).toBeNull();
  });

  it("leaves the tip out: a tip carries no IVA", () => {
    const model = receiptModel([order({ tip: 20, total: 136 })], PLACE, t);
    expect(model.paid).toBe(136);
    expect(model.vatParts).toEqual([{ rate: 16, base: 116 }]);
    expect(vatOf([order({ tip: 20, total: 136 })], 16)).toBe(16);
  });

  it("is what was charged after a discount, not the menu price", () => {
    // MX$136.00 of food, MX$20.00 off, MX$10.00 tip: MX$116.00 was the sale.
    expect(vatOf([order({ subtotal: 136, discount: 20, tip: 10, total: 126 })], 16)).toBe(16);
  });

  it("includes a charge that is part of the sale", () => {
    expect(vatOf([order({ subtotal: 100, service_fee: 16, total: 116 })], 16)).toBe(16);
  });

  it("adds up every order a table paid together, each less its own tip", () => {
    const second = order({ id: "2960abcd-1234-4567-89ab-cdef01234567", subtotal: 58, tip: 12, total: 70 });
    expect(receiptModel([order({ tip: 5, total: 121 }), second], PLACE, t).vatParts).toEqual([{ rate: 16, base: 174 }]);
    expect(vatOf([order({ tip: 5, total: 121 }), second], 16)).toBe(24);
  });

  it("is what the restaurant kept after forgiving part of the bill", () => {
    const forgiven = order({ total: 58, forgiveness: { id: "f", previous_total: 116, resulting_total: 58, forgiven: 58,
      previous_tip: 0, resulting_tip: 0, previous_service_fee: 0, resulting_service_fee: 0 } });
    expect(vatOf([forgiven], 16)).toBe(8);
  });

  it("is a split part's own amount less its own tip", () => {
    // MX$126.00 charged for part 1: MX$116.00 of it the part, MX$10.00 the new tip.
    expect(receiptModel([], PLACE, t, part()).vatParts).toEqual([{ rate: 16, base: 116 }]);
    expect(vatOf([], 16, part())).toBe(16);
    expect(vatOf([], 8, part({ amount: 118, tip: 10, tax_pct: 8 }))).toBe(8);
  });

  it("is a split part's retained amount after a return", () => {
    const returned = part({ return_components: { total: 58, tip: 0, service_fee: 0 } });
    expect(receiptModel([], PLACE, t, returned).paid).toBe(68);
    expect(vatOf([], 16, returned)).toBe(8);
  });

  it("is not printed for a part whose split carried tips added before it (ambiguous)", () => {
    // The parts are shares of a debt that held old tips: nobody can say how
    // much of this MX$116.00 is sale. No line beats a wrong amount.
    expect(receiptModel([], PLACE, t, part({ parts_without_tips: false })).vatParts).toBeNull();
    expect(receiptModel([], PLACE, t, part({ parts_without_tips: undefined })).vatParts).toBeNull();
  });

  it("is not printed when a tip is larger than the total it is part of", () => {
    expect(receiptModel([order({ tip: 200, total: 116 })], PLACE, t).vatParts).toBeNull();
  });
});

describe("the saved order rate", () => {
  it("does not guess a missing rate and keeps mixed rates separate", () => {
    expect(receiptModel([order({ tax_pct: undefined })], PLACE, t).vatParts).toBeNull();
    expect(receiptModel([order(), order({ tax_pct: 8, total: 108 })], PLACE, t).vatParts)
      .toEqual([{ rate: 16, base: 116 }, { rate: 8, base: 108 }]);
    expect(receiptModel([], PLACE, t, part({ tax_pct: undefined })).vatParts).toBeNull();
  });

  it("uses the existing snapshot without adding a second restaurant tax setting", () => {
    expect(readFileSync("supabase/schema.sql", "utf8")).not.toContain("ticket_vat_rate");
    expect(readFileSync("src/lib/ticket-place.ts", "utf8")).not.toContain("ticket_vat_rate");
    expect(readFileSync("src/lib/receipt-source.ts", "utf8")).toContain("tax_pct");
  });
});
