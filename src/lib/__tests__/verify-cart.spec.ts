import { describe, expect, it } from "vitest";
import {
  cartReferences,
  MAX_CART_LINES,
  MAX_CART_REFS,
  verifyCart,
  type VerifiableItem,
} from "@/lib/verify-cart";
import { DISH_NAME_MAX } from "@/lib/notes";
import type { PromotionWithItems } from "@/lib/promotions";
import type { OrderLineItem } from "@/lib/types";

/**
 * These are the rules that stand between a forged payload and the till, so
 * they are asserted directly rather than through the checkout route.
 */

const item = (over: Partial<VerifiableItem> = {}): VerifiableItem => ({
  id: "burger",
  name: "Cheeseburger",
  price: 100,
  emoji: "🍔",
  available: true,
  discount_pct: 0,
  modifiers: null,
  category_id: "mains",
  ...over,
});

const line = (over: Partial<OrderLineItem> = {}): OrderLineItem => ({
  itemId: "burger",
  name: "Cheeseburger",
  emoji: "🍔",
  price: 100,
  qty: 1,
  mods: {},
  ...over,
});

const open = () => true;

const run = (
  items: OrderLineItem[],
  dbItems: VerifiableItem[],
  promotions: PromotionWithItems[] = [],
  isOnOpenMenu: (c: string | null) => boolean = open,
) => verifyCart({ items, promotions, dbItems, isOnOpenMenu });

describe("verifyCart — prices come from the database", () => {
  it("ignores the price the client claims", () => {
    const res = run([line({ price: 1 })], [item({ price: 100 })]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines[0].price).toBe(100);
  });

  it("ignores a discount the client invents", () => {
    const res = run([line({ discountPct: 90 })], [item({ discount_pct: 10 })]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines[0].discountPct).toBe(10);
  });

  it("re-prices extras, so a forged free upgrade still costs money", () => {
    const res = run(
      [line({ extras: [{ id: "truffle", name: "Truffle oil", emoji: "🍄", price: 0 }] })],
      [item(), item({ id: "truffle", name: "Truffle oil", price: 45, emoji: "🍄" })],
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines[0].extras?.[0].price).toBe(45);
  });

  it("floors a fractional quantity and never goes below one", () => {
    const res = run([line({ qty: 2.7 })], [item()]);
    if (res.ok) expect(res.lines[0].qty).toBe(2);
    const zero = run([line({ qty: 0 })], [item()]);
    if (zero.ok) expect(zero.lines[0].qty).toBe(1);
  });
});

describe("verifyCart — what can't be ordered", () => {
  it("rejects a dish marked unavailable", () => {
    const res = run([line()], [item({ available: false })]);
    expect(res).toMatchObject({ ok: false, rejection: { kind: "unavailable" } });
  });

  it("rejects a dish the client references but the restaurant doesn't have", () => {
    const res = run([line({ itemId: "someone-elses-dish" })], [item()]);
    expect(res).toMatchObject({ ok: false, rejection: { kind: "unavailable" } });
  });

  it("rejects a dish whose menu isn't serving right now", () => {
    const res = run([line()], [item()], [], () => false);
    expect(res).toMatchObject({ ok: false, rejection: { kind: "unavailable" } });
  });

  it("rejects a line missing a required option", () => {
    const res = run(
      [line({ mods: {} })],
      [item({ modifiers: [{ label: "Doneness", type: "single", options: ["Rare"], required: true }] })],
    );
    expect(res).toMatchObject({
      ok: false,
      rejection: { kind: "missingModifiers", unanswered: ["Doneness"] },
    });
  });

  it("accepts the line once that option is answered", () => {
    const res = run(
      [line({ mods: { Doneness: "Rare" } })],
      [item({ modifiers: [{ label: "Doneness", type: "single", options: ["Rare"], required: true }] })],
    );
    expect(res.ok).toBe(true);
  });

  it("asks the customer to confirm when an extra has gone", () => {
    const res = run(
      [line({ extras: [{ id: "bacon", name: "Bacon", emoji: "🥓", price: 20 }] })],
      [item(), item({ id: "bacon", name: "Bacon", available: false })],
    );
    expect(res).toMatchObject({
      ok: false,
      rejection: { kind: "removedExtras", ids: ["bacon"], names: ["Bacon"] },
    });
  });
});

describe("verifyCart — combos are priced by the promotion, not the cart", () => {
  const combo: PromotionWithItems = {
    id: "meal",
    restaurant_id: "r1",
    kind: "combo",
    name: "Meal Deal",
    emoji: "🌮",
    description: null,
    combo_price: 120,
    buy_qty: null,
    pay_qty: null,
    tiers: null,
    active: true,
    sort_order: 0,
    items: [
      { item_id: "burger", qty: 1 },
      { item_id: "fries", qty: 1 },
    ],
  };
  const parts = [item(), item({ id: "fries", name: "Fries", price: 50, emoji: "🍟" })];

  it("charges the promotion's price, not the client's", () => {
    const res = run([line({ comboId: "meal", itemId: "meal", price: 5 })], parts, [combo]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines[0].price).toBe(120);
  });

  it("takes its components from the promotion row", () => {
    const res = run(
      [
        line({
          comboId: "meal",
          itemId: "meal",
          components: [{ itemId: "caviar", name: "Caviar", emoji: "🥄", qty: 1, mods: {} }],
        }),
      ],
      parts,
      [combo],
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.lines[0].components?.map(c => c.itemId)).toEqual(["burger", "fries"]);
    }
  });

  it("rejects a bundle whose component has gone unavailable", () => {
    const res = run(
      [line({ comboId: "meal", itemId: "meal" })],
      [item(), item({ id: "fries", name: "Fries", available: false })],
      [combo],
    );
    expect(res).toMatchObject({ ok: false, rejection: { kind: "unavailable" } });
  });

  it("rejects a combo id that isn't a live promotion", () => {
    const res = run([line({ comboId: "invented", itemId: "invented" })], parts, [combo]);
    expect(res).toMatchObject({ ok: false, rejection: { kind: "unavailable" } });
  });

  it("charges extras attached to a bundle at their database price", () => {
    const res = run(
      [
        line({
          comboId: "meal",
          itemId: "meal",
          extras: [{ id: "truffle", name: "Truffle oil", emoji: "🍄", price: 0 }],
        }),
      ],
      [...parts, item({ id: "truffle", name: "Truffle oil", price: 45, emoji: "🍄" })],
      [combo],
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lines[0].extras?.[0].price).toBe(45);
  });
});

describe("an order has a ceiling", () => {
  it("refuses more lines than any real order carries", () => {
    // Nothing capped this. One request built an order of ten thousand lines:
    // MX$115,500 on the board as a single card, three and a half seconds of
    // server time, and a kitchen ticket queued for a thermal printer that
    // would still be spooling at closing time. No screen can produce it — the
    // cap belongs on the route, because the route is what somebody can call.
    const result = run(
      Array.from({ length: MAX_CART_LINES + 1 }, () => line()),
      [item()],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection).toEqual({ kind: "tooManyLines", limit: MAX_CART_LINES });
    }
  });

  it("counts the lines before it prices any of them", () => {
    // With no rows at all, a cart under the cap fails on the DISH being
    // unknown. Over the cap it fails on the count instead — which is the proof
    // the guard runs first and the per-line work never happens.
    const over = run(Array.from({ length: MAX_CART_LINES + 1 }, () => line()), []);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.rejection.kind).toBe("tooManyLines");

    const under = run([line()], []);
    expect(under.ok).toBe(false);
    if (!under.ok) expect(under.rejection.kind).toBe("unavailable");
  });

  it("lets a long table through", () => {
    // Fifty lines is a real party of twelve, and must still be priced.
    const result = run(Array.from({ length: 50 }, () => line()), [item()]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lines).toHaveLength(50);
  });
});

describe("a refusal quotes the cart, so it trims it", () => {
  it("caps the name it reads back when the dish is gone", () => {
    // The name comes from the request when no row has it, and a forged payload
    // sent a megabyte of it — which came back as a megabyte of error for a
    // toast to render.
    const result = run([line({ itemId: "ghost", name: "A".repeat(5000) })], []);
    expect(result.ok).toBe(false);
    if (!result.ok && result.rejection.kind === "unavailable") {
      expect(result.rejection.name).toHaveLength(DISH_NAME_MAX);
    }
  });

  it("still names a dish nobody would call long", () => {
    const result = run([line({ itemId: "ghost", name: "Enchiladas suizas" })], []);
    expect(result.ok).toBe(false);
    if (!result.ok && result.rejection.kind === "unavailable") {
      expect(result.rejection.name).toBe("Enchiladas suizas");
    }
  });
});

describe("a cart is measured before its rows are fetched", () => {
  it("refuses more products than a lookup can ask about", () => {
    // The lines cap alone does not bound the query: PostgREST puts `.in(...)`
    // in a URL, and two hundred lines carrying ten extras each is two thousand
    // ids — a Bad Request at one thousand, a 414 at five. The fetch then came
    // back empty and the cart was refused for the wrong reason.
    // Distinct ids, because the list is deduped — which is also why the cap
    // bites on a forged cart of invented extras rather than on a real one,
    // where the same handful of add-ons repeats down the ticket.
    const extras = (row: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `extra-${row}-${i}`,
        name: "Extra",
        emoji: "➕",
        price: 1,
      }));
    const refs = cartReferences(
      Array.from({ length: 100 }, (_, row) => line({ itemId: `d-${row}`, extras: extras(row, 20) })),
      [],
    );
    expect(refs.ok).toBe(false);
    if (!refs.ok) {
      expect(refs.rejection).toEqual({ kind: "tooManyRefs", limit: MAX_CART_REFS });
    }
  });

  it("still caps the lines, before it counts anything else", () => {
    const refs = cartReferences(Array.from({ length: MAX_CART_LINES + 1 }, () => line()), []);
    expect(refs.ok).toBe(false);
    if (!refs.ok) expect(refs.rejection.kind).toBe("tooManyLines");
  });

  it("hands back the ids a real order refers to", () => {
    const refs = cartReferences(
      [line(), line({ itemId: "fries", extras: [{ id: "cheese", name: "Cheese", emoji: "🧀", price: 10 }] })],
      [],
    );
    expect(refs.ok).toBe(true);
    if (refs.ok) expect(refs.ids).toEqual(["burger", "fries", "cheese"]);
  });
});

describe("the product cap bites forged carts, not real ones", () => {
  it("lets a long ticket through when the same add-ons repeat", () => {
    // Two hundred lines off a menu of a dozen dishes and half a dozen extras
    // is a busy Saturday, not an attack. Deduping is what keeps it legal.
    const extras = [
      { id: "cheese", name: "Cheese", emoji: "🧀", price: 10 },
      { id: "bacon", name: "Bacon", emoji: "🥓", price: 15 },
    ];
    const refs = cartReferences(
      Array.from({ length: MAX_CART_LINES }, (_, i) => line({ itemId: `dish-${i % 12}`, extras })),
      [],
    );
    expect(refs.ok).toBe(true);
    if (refs.ok) expect(refs.ids).toHaveLength(14);
  });
});
