import { describe, expect, it } from "vitest";
import { inSale, plainTwin, quickLine, remember, topSellers } from "@/lib/pos-quick";
import type { MenuItem, OrderLineItem } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";

/**
 * A café judges the till "by how quickly a new employee can serve a queue":
 * a dish with nothing to choose is one tap, the best sellers are on top, and
 * the order before can be rung again.
 */

const dish = (over: Partial<MenuItem> = {}): MenuItem =>
  ({ id: "latte", name: "Latte", emoji: "☕", price: 48, discount_pct: 0, available: true, is_addon: false, modifiers: [], ...over }) as MenuItem;
const line = (over: Partial<OrderLineItem> = {}): OrderLineItem =>
  ({ itemId: "latte", name: "Latte", emoji: "☕", price: 48, qty: 1, mods: {}, extras: [], ...over });

describe("one tap at the till", () => {
  it("adds a dish with nothing to choose, at its price", () => {
    expect(quickLine(dish({ discount_pct: 10 }), 0)).toEqual({
      itemId: "latte", name: "Latte", emoji: "☕", price: 48, discountPct: 10, qty: 1, mods: {}, extras: [],
    });
  });

  it("opens the dish instead when there is an option or an extra to choose", () => {
    expect(quickLine(dish({ modifiers: [{ label: "Leche", options: ["Entera", "Almendra"], required: true }] as MenuItem["modifiers"] }), 0)).toBeNull();
    expect(quickLine(dish(), 2)).toBeNull();
  });

  it("adds to the plain line of the same dish, never to one with a note or an option on it", () => {
    const lines = [
      { ...line({ notes: "sin azúcar" }), cartId: 1 },
      { ...line({ mods: { Leche: "Almendra" } }), cartId: 2 },
      { ...line(), cartId: 3 },
    ] as CartItem[];
    expect(plainTwin(lines, "latte")?.cartId).toBe(3);
    expect(plainTwin(lines.slice(0, 2), "latte")).toBeUndefined();
  });

  it("counts what the sale holds of each dish, leaving combos to their own line", () => {
    const counts = inSale([line({ qty: 2 }), line({ notes: "x" }), line({ itemId: "combo", components: [{}] as OrderLineItem["components"] })]);
    expect(counts.get("latte")).toBe(3);
    expect(counts.has("combo")).toBe(false);
  });
});

describe("what sells most", () => {
  it("ranks dishes by quantity sold, only those still sellable", () => {
    const menu = [dish(), dish({ id: "mocha" }), dish({ id: "gone", available: false }), dish({ id: "milk", is_addon: true })];
    const orders = [
      { items: [line({ qty: 2 }), line({ itemId: "mocha" })] },
      { items: [line({ itemId: "mocha", qty: 3 }), line({ itemId: "gone", qty: 9 }), line({ itemId: "milk", qty: 9 })] },
      { items: null },
    ];
    expect(topSellers(orders, menu)).toEqual(["mocha", "latte"]);
  });
});

describe("the last sale, kept to ring again", () => {
  it("keeps what was chosen by id, not what it cost, and leaves combos out", () => {
    const kept = remember([
      line({ qty: 2, mods: { Leche: "Almendra" }, extras: [{ id: "shot", name: "Shot", emoji: "", price: 10 }], notes: "caliente" }),
      line({ itemId: "combo", components: [{}] as OrderLineItem["components"] }),
    ]);
    expect(kept).toEqual([{ itemId: "latte", qty: 2, mods: { Leche: "Almendra" }, extras: ["shot"], notes: "caliente" }]);
  });
});
