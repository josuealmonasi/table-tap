import { describe, expect, it } from "vitest";
import { suggestItems } from "@/lib/suggestions";
import type { CartItem } from "@/hooks/useCart";
import type { MenuItem } from "@/lib/types";

const dish = (over: Partial<MenuItem> & { id: string }): MenuItem =>
  ({
    name: over.id,
    description: "",
    price: 10,
    emoji: "🍽️",
    image_url: null,
    popular: false,
    available: true,
    is_addon: false,
    modifiers: [],
    sort_order: 0,
    category_id: "mains",
    discount_pct: 0,
    ...over,
  }) as MenuItem;

const line = (itemId: string): CartItem =>
  ({ itemId, name: itemId, emoji: "🍽️", price: 10, qty: 1, mods: {}, cartId: 1 }) as CartItem;

describe("what to offer before they order", () => {
  const menu = [
    dish({ id: "burger", category_id: "mains" }),
    dish({ id: "steak", category_id: "mains", popular: true }),
    dish({ id: "cola", category_id: "drinks" }),
    dish({ id: "cake", category_id: "desserts" }),
  ];

  it("offers nothing when the cart is empty — there is no order to add to", () => {
    expect(suggestItems({ cart: [], items: menu })).toEqual([]);
  });

  it("never offers what is already in the cart", () => {
    const out = suggestItems({ cart: [line("burger")], items: menu });
    expect(out.map(i => i.id)).not.toContain("burger");
  });

  it("prefers a course the order is missing over another of the same", () => {
    // Two mains in the cart: the drink and the dessert come first, not a steak.
    const out = suggestItems({ cart: [line("burger"), line("steak")], items: menu, limit: 2 });
    expect(out.map(i => i.id).sort()).toEqual(["cake", "cola"]);
  });

  it("falls back to popular, then to how other diners rated it", () => {
    const drinks = [
      dish({ id: "water", category_id: "drinks" }),
      dish({ id: "wine", category_id: "drinks", popular: true }),
      dish({ id: "beer", category_id: "drinks" }),
    ];
    const out = suggestItems({
      cart: [line("burger")],
      items: [menu[0], ...drinks],
      ratings: { beer: { avg: 4.8, count: 30 } },
      limit: 3,
    });
    expect(out.map(i => i.id)).toEqual(["wine", "beer", "water"]);
  });

  it("skips dishes that are unavailable or are add-ons", () => {
    const out = suggestItems({
      cart: [line("burger")],
      items: [
        menu[0],
        dish({ id: "soldout", category_id: "drinks", available: false }),
        dish({ id: "extra", category_id: "drinks", is_addon: true }),
        dish({ id: "cola", category_id: "drinks" }),
      ],
    });
    expect(out.map(i => i.id)).toEqual(["cola"]);
  });
});
