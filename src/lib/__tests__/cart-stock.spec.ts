import { describe, expect, it } from "vitest";
import { trimCartToStock, trimChangesCart } from "@/lib/cart-stock";
import type { OrderLineItem } from "@/lib/types";

function line(over: Partial<OrderLineItem> & { cartId: number }) {
  return {
    itemId: "taco",
    name: "Taco",
    emoji: "🌮",
    price: 30,
    qty: 1,
    mods: {},
    ...over,
  };
}

describe("trimCartToStock", () => {
  it("cuts a line down to what is left", () => {
    const out = trimCartToStock([line({ cartId: 1, qty: 6 })], [{ itemId: "taco", available: 5 }]);
    expect(out).toHaveLength(1);
    expect(out[0].qty).toBe(5);
  });

  it("leaves a line that already fits", () => {
    const out = trimCartToStock([line({ cartId: 1, qty: 2 })], [{ itemId: "taco", available: 5 }]);
    expect(out[0].qty).toBe(2);
  });

  it("spends the stock front to back across lines of the same dish", () => {
    // The line they added first keeps what it asked for.
    const out = trimCartToStock(
      [line({ cartId: 1, qty: 3 }), line({ cartId: 2, qty: 4 })],
      [{ itemId: "taco", available: 5 }],
    );
    expect(out.map(l => l.qty)).toEqual([3, 2]);
  });

  it("drops a line left with nothing", () => {
    const out = trimCartToStock(
      [line({ cartId: 1, qty: 5 }), line({ cartId: 2, qty: 2 })],
      [{ itemId: "taco", available: 5 }],
    );
    expect(out.map(l => l.cartId)).toEqual([1]);
  });

  it("removes the dish entirely when nothing is left", () => {
    const out = trimCartToStock([line({ cartId: 1, qty: 2 })], [{ itemId: "taco", available: 0 }]);
    expect(out).toEqual([]);
  });

  it("does not touch dishes the kitchen said nothing about", () => {
    const out = trimCartToStock(
      [line({ cartId: 1, itemId: "agua", qty: 9 })],
      [{ itemId: "taco", available: 1 }],
    );
    expect(out[0].qty).toBe(9);
  });

  it("leaves combos alone", () => {
    // A combo eats from each component's count, so "one fewer combo" has no
    // single meaning here — the customer is told which dish ran short instead.
    const out = trimCartToStock(
      [line({ cartId: 1, itemId: "combo-1", comboId: "combo-1", qty: 4 })],
      [{ itemId: "combo-1", available: 1 }],
    );
    expect(out[0].qty).toBe(4);
  });

  it("returns the cart untouched when there are no limits", () => {
    const items = [line({ cartId: 1, qty: 3 })];
    expect(trimCartToStock(items, [])).toBe(items);
  });
});

describe("trimChangesCart", () => {
  it("is false when nothing would move", () => {
    expect(trimChangesCart([line({ cartId: 1, qty: 2 })], [{ itemId: "taco", available: 5 }])).toBe(
      false,
    );
  });

  it("is true when a quantity would fall", () => {
    expect(trimChangesCart([line({ cartId: 1, qty: 9 })], [{ itemId: "taco", available: 5 }])).toBe(
      true,
    );
  });

  it("is true when a line would go", () => {
    expect(trimChangesCart([line({ cartId: 1, qty: 2 })], [{ itemId: "taco", available: 0 }])).toBe(
      true,
    );
  });
});
