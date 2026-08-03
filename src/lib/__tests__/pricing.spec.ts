import { describe, it, expect } from "vitest";
import { itemSalePrice, priceCart, type CartPromo, type PriceInput } from "@/lib/pricing";
import type { OrderLineItem } from "@/lib/types";

function line(over: Partial<OrderLineItem> = {}): OrderLineItem {
  return { itemId: "taco", name: "Taco", emoji: "🌮", price: 5, qty: 1, mods: {}, ...over };
}

function price(over: Partial<PriceInput> = {}) {
  return priceCart({ items: [], servicePct: 0, serviceEnabled: false, ...over });
}

describe("itemSalePrice", () => {
  it("takes the percentage off", () => {
    expect(itemSalePrice(13, 50)).toBe(6.5);
    expect(itemSalePrice(5, 20)).toBe(4);
  });

  it("returns the full price with no discount", () => {
    expect(itemSalePrice(13)).toBe(13);
    expect(itemSalePrice(13, 0)).toBe(13);
    expect(itemSalePrice(13, null)).toBe(13);
  });

  it("clamps out-of-range percentages", () => {
    expect(itemSalePrice(10, -5)).toBe(10);
    expect(itemSalePrice(10, 150)).toBe(0);
  });

  it("rounds to cents", () => {
    expect(itemSalePrice(9.99, 33)).toBe(6.69);
  });

  it("agrees with what priceCart charges", () => {
    const r = priceCart({
      items: [line({ price: 13, qty: 2, discountPct: 50 })],
      servicePct: 0,
      serviceEnabled: false,
    });
    expect(r.subtotal).toBe(itemSalePrice(13, 50) * 2);
  });
});

describe("priceCart — basics", () => {
  it("is all zeroes for an empty cart", () => {
    const r = price();
    expect(r).toMatchObject({ grossSubtotal: 0, discount: 0, subtotal: 0, total: 0 });
  });

  it("sums lines and multiplies by quantity", () => {
    const r = price({ items: [line({ qty: 3 })] });
    expect(r.grossSubtotal).toBe(15);
    expect(r.total).toBe(15);
  });

  it("adds extras at full price", () => {
    const r = price({
      items: [line({ extras: [{ id: "e", name: "Cheese", emoji: "🧀", price: 2 }] })],
    });
    expect(r.grossSubtotal).toBe(7);
  });
});

describe("priceCart — item discounts", () => {
  it("halves a 50%-off item and reports the saving", () => {
    const r = price({ items: [line({ discountPct: 50 })] });
    expect(r.itemDiscount).toBe(2.5);
    expect(r.subtotal).toBe(2.5);
    expect(r.grossSubtotal).toBe(5); // gross stays the original price
  });

  it("never discounts extras", () => {
    const r = price({
      items: [
        line({
          discountPct: 50,
          extras: [{ id: "e", name: "Cheese", emoji: "🧀", price: 2 }],
        }),
      ],
    });
    // 2.50 for the taco + 2.00 full-price cheese
    expect(r.subtotal).toBe(4.5);
    expect(r.itemDiscount).toBe(2.5);
  });

  it("ignores an out-of-range discount", () => {
    expect(price({ items: [line({ discountPct: -10 })] }).subtotal).toBe(5);
    expect(price({ items: [line({ discountPct: 0 })] }).subtotal).toBe(5);
  });
});

describe("priceCart — quantity promos", () => {
  const twoForOne: CartPromo = {
    id: "p", name: "2x1 Tacos", kind: "bogo", buyQty: 2, payQty: 1, itemIds: ["taco"],
  };

  it("applies 2x1 across the cart", () => {
    const r = price({ items: [line({ qty: 2 })], promos: [twoForOne] });
    expect(r.promoDiscount).toBe(5);
    expect(r.subtotal).toBe(5);
  });

  it("counts the same product spread over separate lines", () => {
    const r = price({
      items: [line({ qty: 1, notes: "no onion" }), line({ qty: 1 })],
      promos: [twoForOne],
    });
    expect(r.promoDiscount).toBe(5);
  });

  it("stacks on top of an item discount", () => {
    // 50% off → 2.50 each; 2x1 then makes the pair cost 2.50.
    const r = price({ items: [line({ qty: 2, discountPct: 50 })], promos: [twoForOne] });
    expect(r.itemDiscount).toBe(5);
    expect(r.promoDiscount).toBe(2.5);
    expect(r.subtotal).toBe(2.5);
  });

  it("emits a hint for the next worthwhile step", () => {
    const r = price({ items: [line({ qty: 1 })], promos: [twoForOne] });
    expect(r.hints).toEqual([
      { itemId: "taco", promoName: "2x1 Tacos", addQty: 1, save: 5 },
    ]);
  });

  it("only lets one deal claim a product", () => {
    const other: CartPromo = { ...twoForOne, id: "p2", name: "3x1" , buyQty: 3 };
    const r = price({ items: [line({ qty: 2 })], promos: [twoForOne, other] });
    expect(r.promoDiscount).toBe(5); // not double-counted
  });

  it("leaves products the promo doesn't cover alone", () => {
    const r = price({
      items: [line({ itemId: "salad", name: "Salad", qty: 2 })],
      promos: [twoForOne],
    });
    expect(r.promoDiscount).toBe(0);
  });
});

describe("priceCart — coupons", () => {
  it("takes a percentage off", () => {
    const r = price({
      items: [line({ qty: 2 })],
      coupon: { code: "GET-50X", kind: "percent", value: 50 },
    });
    expect(r.couponDiscount).toBe(5);
    expect(r.subtotal).toBe(5);
  });

  it("takes a fixed amount off", () => {
    const r = price({
      items: [line({ qty: 2 })],
      coupon: { code: "OFF-3", kind: "fixed", value: 3 },
    });
    expect(r.subtotal).toBe(7);
  });

  it("stacks on top of promos and item discounts", () => {
    const r = price({
      items: [line({ qty: 2, discountPct: 50 })],
      promos: [{ id: "p", name: "2x1", kind: "bogo", buyQty: 2, payQty: 1, itemIds: ["taco"] }],
      coupon: { code: "OFF-1", kind: "fixed", value: 1 },
    });
    // 10 gross → 5 item discount → 2.50 promo → 2.50 left → 1 coupon
    expect(r.couponDiscount).toBe(1);
    expect(r.subtotal).toBe(1.5);
  });

  it("can never discount more than the goods are worth", () => {
    const r = price({
      items: [line()],
      coupon: { code: "BIG-100", kind: "fixed", value: 999 },
    });
    expect(r.couponDiscount).toBe(5);
    expect(r.subtotal).toBe(0);
    expect(r.total).toBe(0);
  });

  it("is ignored below the minimum subtotal", () => {
    const r = price({
      items: [line()],
      coupon: { code: "MIN-20", kind: "fixed", value: 5, minSubtotal: 20 },
    });
    expect(r.couponDiscount).toBe(0);
    expect(r.subtotal).toBe(5);
  });
});

describe("priceCart — service fee and tip", () => {
  it("charges the service fee only when it's switched on", () => {
    expect(price({ items: [line()], servicePct: 10 }).serviceFee).toBe(0);
    expect(
      price({ items: [line()], servicePct: 10, serviceEnabled: true }).serviceFee,
    ).toBe(0.5);
  });

  it("bases the service fee on the DISCOUNTED subtotal", () => {
    const r = price({
      items: [line({ qty: 2 })],
      servicePct: 10,
      serviceEnabled: true,
      coupon: { code: "OFF-5", kind: "fixed", value: 5 },
    });
    expect(r.subtotal).toBe(5);
    expect(r.serviceFee).toBe(0.5); // 10% of 5, not of 10
  });

  it("bases the tip percentage on the DISCOUNTED subtotal", () => {
    const r = price({
      items: [line({ qty: 2 })],
      tipPct: 20,
      coupon: { code: "OFF-5", kind: "fixed", value: 5 },
    });
    expect(r.tip).toBe(1); // 20% of 5
  });

  it("prefers an exact tip and caps it at the subtotal", () => {
    expect(price({ items: [line()], tipPct: 20, tipAmount: 2 }).tip).toBe(2);
    expect(price({ items: [line()], tipAmount: 999 }).tip).toBe(5);
  });

  it("adds up: subtotal + service + tip", () => {
    const r = price({
      items: [line({ qty: 2 })],
      servicePct: 10,
      serviceEnabled: true,
      tipPct: 10,
    });
    expect(r.subtotal).toBe(10);
    expect(r.serviceFee).toBe(1);
    expect(r.tip).toBe(1);
    expect(r.total).toBe(12);
  });
});

describe("priceCart — combos", () => {
  const combo = line({
    itemId: "combo-1",
    comboId: "combo-1",
    name: "Taco Combo",
    price: 12,
    components: [
      { itemId: "taco", name: "Taco", emoji: "🌮", qty: 1 },
      { itemId: "salad", name: "Salad", emoji: "🥗", qty: 1 },
      { itemId: "drink", name: "Drink", emoji: "🥤", qty: 1 },
    ],
  });

  it("charges the bundle price", () => {
    const r = price({ items: [combo] });
    expect(r.subtotal).toBe(12);
  });

  it("is never re-discounted by an item % or a quantity deal", () => {
    const r = price({
      items: [{ ...combo, discountPct: 50 }],
      promos: [{ id: "p", name: "2x1", kind: "bogo", buyQty: 2, payQty: 1, itemIds: ["combo-1"] }],
    });
    expect(r.itemDiscount).toBe(0);
    expect(r.promoDiscount).toBe(0);
    expect(r.subtotal).toBe(12);
  });

  it("still allows a coupon on top", () => {
    const r = price({
      items: [combo],
      coupon: { code: "OFF-2", kind: "fixed", value: 2 },
    });
    expect(r.subtotal).toBe(10);
  });
});

describe("priceCart — money safety", () => {
  it("never returns a negative total", () => {
    const r = price({
      items: [line()],
      coupon: { code: "HUGE", kind: "percent", value: 100 },
      servicePct: 10,
      serviceEnabled: true,
    });
    expect(r.total).toBeGreaterThanOrEqual(0);
  });

  it("keeps everything to two decimals", () => {
    const r = price({
      items: [line({ price: 3.33, qty: 3, discountPct: 33 })],
      servicePct: 7,
      serviceEnabled: true,
      tipPct: 15,
    });
    for (const v of [r.grossSubtotal, r.discount, r.subtotal, r.serviceFee, r.tip, r.total]) {
      expect(v).toBe(Math.round(v * 100) / 100);
    }
  });

  it("discount always equals the sum of its parts", () => {
    const r = price({
      items: [line({ qty: 3, discountPct: 20 })],
      promos: [{ id: "p", name: "2x1", kind: "bogo", buyQty: 2, payQty: 1, itemIds: ["taco"] }],
      coupon: { code: "OFF-1", kind: "fixed", value: 1 },
    });
    expect(r.discount).toBeCloseTo(
      r.itemDiscount + r.promoDiscount + r.couponDiscount,
      10,
    );
    expect(r.subtotal).toBeCloseTo(r.grossSubtotal - r.discount, 10);
  });
});
