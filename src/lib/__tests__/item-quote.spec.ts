import { describe, expect, it } from "vitest";
import { quoteItemLine } from "@/lib/item-quote";
import { priceCart, type CartPromo } from "@/lib/pricing";
import type { OrderLineItem } from "@/lib/types";

const twoForOne: CartPromo = {
  id: "p", name: "2x1", kind: "bogo", buyQty: 2, payQty: 1, itemIds: ["dish"],
};

function line(qty: number, price = 10, extra = 0): OrderLineItem {
  return {
    itemId: "dish", name: "Dish", emoji: "", price, qty, mods: {},
    extras: extra ? [{ id: "x", name: "Extra", emoji: "", price: extra }] : [],
  } as OrderLineItem;
}

const goods = (items: OrderLineItem[], promos: CartPromo[]): number =>
  priceCart({ items, promos, servicePct: 0, serviceEnabled: false }).subtotal;

describe("quoteItemLine", () => {
  it("quotes what the cart goes up by for a modified unit under 2x1", () => {
    // A plain MX$10 dish in the cart, then a second with a MX$5 extra. The
    // per-line formula quoted MX$0; the cart goes up by MX$5.
    const cart = [line(1)];
    const added = line(1, 10, 5);
    const quote = quoteItemLine(cart, added, [twoForOne]);
    expect(quote.total).toBe(5);
    expect(quote.total).toBe(goods([...cart, added], [twoForOne]) - goods(cart, [twoForOne]));
    expect(quote.full).toBe(15);
    expect(quote.applied).toBe(true);
    expect(quote.promoName).toBe("2x1");
  });

  it("charges for one when a 2x1 line of two is added to an empty cart", () => {
    expect(quoteItemLine([], line(2, 6), [twoForOne]).total).toBe(6);
  });

  it("makes the second unit free when one is already in the cart", () => {
    expect(quoteItemLine([line(1, 6)], line(1, 6), [twoForOne]).total).toBe(0);
  });

  it("charges normally with no promo, and names none", () => {
    const quote = quoteItemLine([], line(2, 6), []);
    expect(quote).toMatchObject({ total: 12, full: 12, applied: false, promoName: null, step: null });
  });

  it("gives the free unit away with its extras, not stripped of them", () => {
    expect(quoteItemLine([], line(2, 5, 2), [twoForOne]).total).toBe(7);
  });

  it("handles tiered pricing across the whole product", () => {
    const tiered: CartPromo = {
      id: "t", name: "multi", kind: "tiered", tiers: [{ qty: 2, price: 4.25 }], itemIds: ["dish"],
    };
    expect(quoteItemLine([], line(2, 2.5), [tiered]).total).toBe(4.25);
    expect(quoteItemLine([line(2, 2.5)], line(2, 2.5), [tiered]).total).toBe(4.25);
  });

  it("offers the next step when the deal is not reached yet", () => {
    const quote = quoteItemLine([], line(1), [twoForOne]);
    expect(quote).toMatchObject({ total: 10, applied: false, step: { addQty: 1, save: 10 } });
  });
});
