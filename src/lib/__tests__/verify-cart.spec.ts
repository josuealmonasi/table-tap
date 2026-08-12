import { describe, expect, it } from "vitest";
import { verifyCart, type VerifiableItem } from "@/lib/verify-cart";
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
