import { describe, expect, it } from "vitest";
import { coverDays, dishCount, leadDays } from "@/lib/costs/input";
import { expectedOnHand, purchaseList } from "@/lib/costs/stock";

describe("what the shelf should hold", () => {
  const counts = new Map([["milk", { ingredient_id: "milk", counted: 5000, created_at: "2026-10-10T08:00:00Z" }]]);

  it("starts from the last count and moves only with what came after it", () => {
    const expected = expectedOnHand(
      ["milk", "coffee"], counts,
      [{ id: 1, ingredient_id: "milk", quantity: 2000, kind: "purchase", created_at: "2026-10-11T08:00:00Z" },
        { id: 2, ingredient_id: "milk", quantity: 9999, kind: "purchase", created_at: "2026-10-09T08:00:00Z" },
        { id: 3, ingredient_id: "milk", quantity: -600, kind: "sale", created_at: "2026-10-12T09:00:00Z" },
        { id: 4, ingredient_id: "milk", quantity: -2000, kind: "sale", created_at: "2026-10-09T09:00:00Z" },
        { id: 5, ingredient_id: "milk", quantity: -300, kind: "waste", created_at: "2026-10-12T20:00:00Z" }],
    );
    expect(expected.get("milk")).toBe(5000 + 2000 - 600 - 300);
    expect(expected.get("coffee")).toBeNull();
  });
});

describe("what to buy", () => {
  const ingredients = [
    { id: "milk", name: "Leche", unit: "ml" as const, pack_size: 1000, pack_price: 28, unit_cost: 0.028, supplier: "Lácteos", lead_days: 2 },
    { id: "coffee", name: "Café", unit: "g" as const, pack_size: 1000, pack_price: 380, unit_cost: 0.38, supplier: "Tostador", lead_days: 5 },
    { id: "cups", name: "Vasos", unit: "pza" as const, pack_size: 50, pack_price: 60, unit_cost: 1.2, supplier: null, lead_days: 1 },
  ];

  it("covers the delivery time and the days asked for, less what is there, in whole packs", () => {
    // 1 l a day; 2 days to deliver + 7 days = 9 l; 2.5 l on the shelf: 6.5 l, so 7 packs.
    const list = purchaseList(ingredients, new Map([["milk", 2500]]), new Map([["milk", 14000]]), 14, 7);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ingredientId: "milk", packs: 7, cost: 196, urgent: false });
  });

  it("says to order today what runs out before it would arrive", () => {
    // 100 g a day, 5 days to deliver: 300 g lasts three.
    const [coffee] = purchaseList(ingredients, new Map([["coffee", 300]]), new Map([["coffee", 1400]]), 14, 7);
    expect(coffee).toMatchObject({ urgent: true, packs: 1 });
  });

  it("lists one never counted as if the shelf were empty, and leaves out what is not used", () => {
    const list = purchaseList(ingredients, new Map([["cups", null]]), new Map([["cups", 140]]), 14, 7);
    // 10 a day for 1 + 7 days is 80 cups: two sleeves of 50.
    expect(list).toEqual([expect.objectContaining({ ingredientId: "cups", onHand: null, packs: 2, urgent: false })]);
  });

  it("buys nothing when the shelf already holds enough", () => {
    expect(purchaseList(ingredients, new Map([["milk", 20000]]), new Map([["milk", 14000]]), 14, 7)).toEqual([]);
  });
});

describe("what an owner types about deliveries and waste", () => {
  it("reads whole days and whole dishes", () => {
    expect(leadDays("3")).toBe(3);
    expect(leadDays("0")).toBe(0);
    expect(leadDays("2.5")).toBeNull();
    expect(leadDays("61")).toBeNull();
    expect(coverDays("0")).toBeNull();
    expect(coverDays("7")).toBe(7);
    expect(dishCount("2")).toBe(2);
    expect(dishCount("0")).toBeNull();
    expect(dishCount("1.5")).toBeNull();
  });
});
