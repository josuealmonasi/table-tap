import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { receiptModel, type ReceiptOrder, type SlotReceiptPayment } from "@/lib/receipt";
import { messagesFor, translate } from "@/lib/i18n";
import { DEFAULT_TICKET_VAT_RATE, includedVat, isTicketVatRate, TICKET_VAT_RATES } from "@/lib/ticket-vat";

// "IVA 16% incluido" under the ticket's total (owner's decision, 2026-11-12).
const PLACE = { name: "Demo Bistro", timeZone: "America/Mexico_City", locale: "es-MX" };
const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars);

function order(over: Partial<ReceiptOrder> = {}): ReceiptOrder {
  return {
    id: "1960abcd-1234-4567-89ab-cdef01234567",
    items: [{ itemId: "a", name: "Tacos", emoji: "🌮", price: 58, qty: 2, mods: {} }],
    subtotal: 116, discount: 0, service_fee: 0, tip: 0, total: 116,
    currency: "MXN", table_label: "6", created_at: "2026-11-12T20:00:00Z",
    ...over,
  };
}
function part(over: Partial<SlotReceiptPayment> = {}): SlotReceiptPayment {
  return { id: "5a1e0000-0000-4000-8000-000000000000", amount: 126, tip: 10, currency: "MXN",
    created_at: "2026-11-12T20:00:00Z", slots: [0], parts_without_tips: true, ...over };
}
/** The IVA line a ticket for these orders (or this paid part) prints at `rate`. */
const vatOf = (orders: ReceiptOrder[], rate: number, payment?: SlotReceiptPayment) =>
  includedVat(receiptModel(orders, PLACE, t, payment).vatBase, rate);

describe("the IVA amount", () => {
  it("is what the base contains at the owner's rate", () => {
    expect(includedVat(116, 16)).toBe(16);
    expect(includedVat(108, 8)).toBe(8);
    expect(includedVat(100, 16)).toBe(13.79);
  });

  it("is not printed at 0, at a rate nobody can choose, or with nothing sold", () => {
    expect(includedVat(116, 0)).toBeNull();
    expect(includedVat(116, 12)).toBeNull();
    expect(includedVat(116, null)).toBeNull();
    expect(includedVat(0, 16)).toBeNull();
    expect(includedVat(null, 16)).toBeNull();
  });

  it("offers 16 (the default), 8 and 0", () => {
    expect(TICKET_VAT_RATES).toEqual([16, 8, 0]);
    expect(DEFAULT_TICKET_VAT_RATE).toBe(16);
    expect([16, 8, 0].every(isTicketVatRate)).toBe(true);
    expect([12, "16", 16.5, null].some(isTicketVatRate)).toBe(false);
  });
});

describe("what the IVA is included in", () => {
  it("is the sale on a plain ticket: MX$116.00 at 16 % holds MX$16.00", () => {
    expect(vatOf([order()], 16)).toBe(16);
    expect(vatOf([order({ subtotal: 108, total: 108 })], 8)).toBe(8);
    expect(vatOf([order()], 0)).toBeNull();
  });

  it("leaves the tip out: a tip carries no IVA", () => {
    const model = receiptModel([order({ tip: 20, total: 136 })], PLACE, t);
    expect(model.paid).toBe(136);
    expect(model.vatBase).toBe(116);
    expect(includedVat(model.vatBase, 16)).toBe(16);
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
    expect(receiptModel([order({ tip: 5, total: 121 }), second], PLACE, t).vatBase).toBe(174);
    expect(vatOf([order({ tip: 5, total: 121 }), second], 16)).toBe(24);
  });

  it("is what the restaurant kept after forgiving part of the bill", () => {
    const forgiven = order({ total: 58, forgiveness: { id: "f", previous_total: 116, resulting_total: 58, forgiven: 58,
      previous_tip: 0, resulting_tip: 0, previous_service_fee: 0, resulting_service_fee: 0 } });
    expect(vatOf([forgiven], 16)).toBe(8);
  });

  it("is a split part's own amount less its own tip", () => {
    // MX$126.00 charged for part 1: MX$116.00 of it the part, MX$10.00 the new tip.
    expect(receiptModel([], PLACE, t, part()).vatBase).toBe(116);
    expect(vatOf([], 16, part())).toBe(16);
    expect(vatOf([], 8, part({ amount: 118, tip: 10 }))).toBe(8);
  });

  it("is a split part's retained amount after a return", () => {
    const returned = part({ return_components: { total: 58, tip: 0, service_fee: 0 } });
    expect(receiptModel([], PLACE, t, returned).paid).toBe(68);
    expect(vatOf([], 16, returned)).toBe(8);
  });

  it("is not printed for a part whose split carried tips added before it (ambiguous)", () => {
    // The parts are shares of a debt that held old tips: nobody can say how
    // much of this MX$116.00 is sale. No line beats a wrong amount.
    expect(receiptModel([], PLACE, t, part({ parts_without_tips: false })).vatBase).toBeNull();
    expect(receiptModel([], PLACE, t, part({ parts_without_tips: undefined })).vatBase).toBeNull();
  });

  it("is not printed when a tip is larger than the total it is part of", () => {
    expect(receiptModel([order({ tip: 200, total: 116 })], PLACE, t).vatBase).toBeNull();
  });
});

describe("restaurants.ticket_vat_rate", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");

  it("is 16, 8 or 0, and 16 unless the owner chose", () => {
    expect(schema).toContain("alter table restaurants add column if not exists ticket_vat_rate smallint not null default 16\n"
      + "  check (ticket_vat_rate in (0, 8, 16));");
  });

  it("is never granted to a browser key nor read by the public menu", () => {
    const grants = schema.split("\n").filter(l => /^grant select \(/.test(l) && /on restaurants to (anon|authenticated)/.test(l));
    expect(grants.length).toBeGreaterThan(0);
    for (const line of grants) expect(line).not.toContain("ticket_vat_rate");
    const projection = readFileSync("src/lib/public-menu-rows.ts", "utf8").match(/PUBLIC_RESTAURANT_COLUMNS = "([^"]+)"/)![1].split(", ");
    expect(projection).not.toContain("ticket_vat_rate");
  });

  it("is read with the ticket's issuer block and saved only by the owner", () => {
    expect(readFileSync("src/lib/ticket-place.ts", "utf8")).toMatch(/ticket_font, ticket_vat_rate"/);
    const route = readFileSync("src/app/api/settings/route.ts", "utf8");
    const owner = route.slice(route.indexOf("const OWNER_FIELDS"), route.indexOf("const MANAGER_FIELDS"));
    const manager = route.slice(route.indexOf("const MANAGER_FIELDS"), route.indexOf("export async function POST"));
    expect(owner).toContain('"ticket_vat_rate"');
    expect(manager).not.toContain("ticket_vat_rate");
  });
});
