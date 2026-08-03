import { describe, it, expect } from "vitest";
import { buildCombos, toCartPromos, type PromotionWithItems } from "@/lib/promotions";
import type { MenuItem } from "@/lib/types";

function item(id: string, name: string, price: number, available = true): MenuItem {
  return {
    id,
    restaurant_id: "r1",
    menu_id: "m1",
    category_id: null,
    name,
    description: null,
    price,
    emoji: "🍽️",
    image_url: null,
    popular: false,
    available,
    is_addon: false,
    modifiers: [],
    dietary: [],
    discount_pct: 0,
    sort_order: 0,
  };
}

function promo(over: Partial<PromotionWithItems> = {}): PromotionWithItems {
  return {
    id: "p1",
    restaurant_id: "r1",
    kind: "combo",
    name: "Taco Meal",
    emoji: "🌮",
    description: null,
    combo_price: 12,
    buy_qty: null,
    pay_qty: null,
    tiers: null,
    active: true,
    sort_order: 0,
    items: [
      { item_id: "taco", qty: 1 },
      { item_id: "salad", qty: 1 },
      { item_id: "drink", qty: 1 },
    ],
    ...over,
  };
}

const MENU = new Map<string, MenuItem>([
  ["taco", item("taco", "Taco", 5)],
  ["salad", item("salad", "Salad", 5)],
  ["drink", item("drink", "Drink", 5)],
]);

describe("buildCombos", () => {
  it("builds the user's example: three 5s bundled at 12", () => {
    const [combo] = buildCombos([promo()], MENU);
    expect(combo.price).toBe(12);
    expect(combo.regularPrice).toBe(15);
    expect(combo.components.map(c => c.name)).toEqual(["Taco", "Salad", "Drink"]);
  });

  it("counts a component's quantity in the regular price", () => {
    const p = promo({ items: [{ item_id: "taco", qty: 3 }, { item_id: "drink", qty: 1 }] });
    const [combo] = buildCombos([p], MENU);
    expect(combo.regularPrice).toBe(20); // 3×5 + 5
    expect(combo.components[0].qty).toBe(3);
  });

  it("drops the combo when a component sold out", () => {
    const menu = new Map(MENU);
    menu.set("drink", item("drink", "Drink", 5, false));
    expect(buildCombos([promo()], menu)).toEqual([]);
  });

  it("drops the combo when a component no longer exists", () => {
    const menu = new Map(MENU);
    menu.delete("salad");
    expect(buildCombos([promo()], menu)).toEqual([]);
  });

  it("ignores paused combos and non-combo kinds", () => {
    expect(buildCombos([promo({ active: false })], MENU)).toEqual([]);
    expect(buildCombos([promo({ kind: "bogo" })], MENU)).toEqual([]);
  });

  it("ignores a combo with no price or no items", () => {
    expect(buildCombos([promo({ combo_price: null })], MENU)).toEqual([]);
    expect(buildCombos([promo({ items: [] })], MENU)).toEqual([]);
  });
});

describe("toCartPromos", () => {
  it("passes quantity deals through and leaves combos out", () => {
    const deals = toCartPromos([
      promo(),
      promo({ id: "p2", kind: "bogo", name: "2x1", buy_qty: 2, pay_qty: 1 }),
      promo({ id: "p3", kind: "tiered", name: "Drinks", tiers: [{ qty: 2, price: 8 }] }),
    ]);
    expect(deals.map(d => d.id)).toEqual(["p2", "p3"]);
    expect(deals[0]).toMatchObject({ kind: "bogo", buyQty: 2, payQty: 1 });
    expect(deals[1].tiers).toEqual([{ qty: 2, price: 8 }]);
  });

  it("leaves paused deals out", () => {
    const deals = toCartPromos([promo({ kind: "bogo", active: false })]);
    expect(deals).toEqual([]);
  });

  it("carries the covered item ids", () => {
    const deals = toCartPromos([promo({ kind: "bogo", items: [{ item_id: "drink", qty: 1 }] })]);
    expect(deals[0].itemIds).toEqual(["drink"]);
  });
});
