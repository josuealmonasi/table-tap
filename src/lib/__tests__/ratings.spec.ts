import { describe, expect, it } from "vitest";
import { acceptableRatings, isValidRating, rateableDishes } from "../ratings";
import type { OrderLineItem } from "../types";

const line = (over: Partial<OrderLineItem> = {}): OrderLineItem => ({
  itemId: "i1",
  name: "Tonkotsu Ramen",
  emoji: "🍜",
  price: 14.9,
  qty: 1,
  mods: {},
  ...over,
});

describe("isValidRating", () => {
  it("accepts 1 through 5", () => {
    expect([1, 2, 3, 4, 5].every(isValidRating)).toBe(true);
  });

  it("rejects out-of-range, fractional and non-numeric values", () => {
    // All shapes a forged payload could take.
    for (const bad of [0, 6, -1, 4.5, "5", null, undefined, NaN, Infinity]) {
      expect(isValidRating(bad)).toBe(false);
    }
  });
});

describe("rateableDishes", () => {
  it("lists the dishes in an order", () => {
    const got = rateableDishes([
      { id: "o1", items: [line(), line({ itemId: "i2", name: "Gyoza", emoji: "🥟" })] },
    ]);
    expect(got.map(d => d.itemId)).toEqual(["i1", "i2"]);
    expect(got[0].orderId).toBe("o1");
  });

  it("counts a dish once even when ordered on two lines", () => {
    // Same dish with different modifiers is still one opinion — and the unique
    // (order_id, item_id) constraint would reject the second regardless.
    const got = rateableDishes([
      { id: "o1", items: [line(), line({ mods: { Spice: "Hot" } })] },
    ]);
    expect(got).toHaveLength(1);
  });

  it("keeps the same dish from two different orders apart", () => {
    // Ordering it again on another visit earns another say.
    const got = rateableDishes([
      { id: "o1", items: [line()] },
      { id: "o2", items: [line()] },
    ]);
    expect(got.map(d => d.orderId)).toEqual(["o1", "o2"]);
  });

  it("skips combos — a bundle isn't a dish", () => {
    const got = rateableDishes([
      { id: "o1", items: [line({ itemId: "c1", comboId: "c1", name: "Meal Deal" })] },
    ]);
    expect(got).toEqual([]);
  });

  it("drops what's already been rated", () => {
    const got = rateableDishes([{ id: "o1", items: [line(), line({ itemId: "i2" })] }], [
      { orderId: "o1", itemId: "i1" },
    ]);
    expect(got.map(d => d.itemId)).toEqual(["i2"]);
  });

  it("survives an order with no items", () => {
    expect(rateableDishes([{ id: "o1", items: [] }])).toEqual([]);
  });
});

describe("acceptableRatings", () => {
  const entitled = [
    { itemId: "i1", orderId: "o1", name: "Ramen", emoji: "🍜" },
    { itemId: "i2", orderId: "o1", name: "Gyoza", emoji: "🥟" },
  ];

  it("keeps ratings for dishes that were actually bought", () => {
    const got = acceptableRatings([{ itemId: "i1", orderId: "o1", rating: 5 }], entitled);
    expect(got).toHaveLength(1);
  });

  it("drops a dish that wasn't in the order", () => {
    // The forged case: naming a dish you never bought.
    expect(acceptableRatings([{ itemId: "i9", orderId: "o1", rating: 5 }], entitled)).toEqual(
      [],
    );
  });

  it("drops someone else's order id", () => {
    expect(acceptableRatings([{ itemId: "i1", orderId: "o9", rating: 5 }], entitled)).toEqual(
      [],
    );
  });

  it("drops an out-of-range score", () => {
    expect(acceptableRatings([{ itemId: "i1", orderId: "o1", rating: 99 }], entitled)).toEqual(
      [],
    );
  });

  it("keeps only the first of a duplicated pair", () => {
    const got = acceptableRatings(
      [
        { itemId: "i1", orderId: "o1", rating: 5 },
        { itemId: "i1", orderId: "o1", rating: 1 },
      ],
      entitled,
    );
    expect(got).toEqual([{ itemId: "i1", orderId: "o1", rating: 5 }]);
  });

  it("keeps the good lines when one is bad", () => {
    // A single forged entry shouldn't cost the honest ratings beside it.
    const got = acceptableRatings(
      [
        { itemId: "i1", orderId: "o1", rating: 4 },
        { itemId: "i9", orderId: "o1", rating: 5 },
        { itemId: "i2", orderId: "o1", rating: 3 },
      ],
      entitled,
    );
    expect(got.map(r => r.itemId)).toEqual(["i1", "i2"]);
  });

  it("accepts nothing when nothing was bought", () => {
    expect(acceptableRatings([{ itemId: "i1", orderId: "o1", rating: 5 }], [])).toEqual([]);
  });
});

describe("a malformed id costs its own line, not the batch", () => {
  it("only calls a uuid storable", async () => {
    // A dev order once carried `itemId: "x"`. It really was in the order, so
    // the purchase check passed, and the insert then failed on the uuid column
    // — turning one bad line into a 503 for everything sent with it. The route
    // filters with this before writing.
    const { isStorableId } = await import("@/lib/ratings");
    expect(isStorableId("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(isStorableId("x")).toBe(false);
    expect(isStorableId("")).toBe(false);
    expect(isStorableId("11111111-2222-3333-4444-5555555555")).toBe(false);
  });
});
