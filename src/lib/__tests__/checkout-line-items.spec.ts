import { describe, expect, it } from "vitest";
import type { OrderLineItem } from "@/lib/types";
import { checkoutLineItems } from "@/lib/checkout/line-items";

const taco = {
  itemId: "t", name: "Taco", emoji: "🌮", price: 50, qty: 2, discountPct: 10,
  mods: { Salsa: "verde", Extras: ["queso"] }, extras: [{ id: "x", name: "Aguacate", price: 15 }],
} as unknown as OrderLineItem;

describe("what Stripe Checkout lists and charges", () => {
  it("charges each dish at its sale price plus its extras, in cents, and says what was chosen", () => {
    const [line] = checkoutLineItems({ verified: [taco], currency: "mxn", serviceFee: 0, servicePct: 0, tip: 0, tipLabel: "Tip" });
    expect(line.quantity).toBe(2);
    expect(line.price_data?.unit_amount).toBe(6000); // 45 sale + 15 extra
    expect(line.price_data?.product_data?.name).toBe("🌮 Taco");
    expect(line.price_data?.product_data?.description).toBe("Salsa: verde · Extras: queso · Extras: Aguacate");
  });

  it("adds the service charge and the tip as their own lines, only when there is one", () => {
    const lines = checkoutLineItems({ verified: [taco], currency: "mxn", serviceFee: 9.6, servicePct: 10, tip: 12.5, tipLabel: "Tip (15%)" });
    expect(lines.slice(1).map(l => [l.price_data?.product_data?.name, l.price_data?.unit_amount])).toEqual([
      ["Service charge (10%)", 960],
      ["Tip (15%)", 1250],
    ]);
    expect(checkoutLineItems({ verified: [taco], currency: "mxn", serviceFee: 0, servicePct: 10, tip: 0, tipLabel: "Tip" })).toHaveLength(1);
  });
});
