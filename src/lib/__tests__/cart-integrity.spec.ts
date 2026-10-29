import { describe, expect, it } from "vitest";
import { cartReferences, verifyCart, type VerifiableItem } from "@/lib/verify-cart";
import { comboCartLine } from "@/lib/combo-config";
import { buildCombos, type PromotionWithItems } from "@/lib/promotions";
import { priceCart } from "@/lib/pricing";
import { stockDemand } from "@/lib/stock";
import { kitchenTicket } from "@/lib/ticket";
import { removeLineExtras } from "@/lib/cart-extras";
import type { MenuItem, OrderLineItem } from "@/lib/types";

const burger: VerifiableItem = {
  id: "burger", name: "Burger", price: 100, emoji: "", available: true,
  discount_pct: 0, category_id: null, menu_id: "dinner", is_addon: false,
  item_addons: [{ addon_id: "cheese" }],
  modifiers: [
    { label: "Size", type: "single", options: ["Small", "Large"], required: true },
    { label: "Sauces", type: "multi", options: ["Hot", "Mild"] },
  ],
};
const cheese: VerifiableItem = { ...burger, id: "cheese", name: "Cheese", price: 25, modifiers: [], is_addon: true };
const promotion: PromotionWithItems = {
  id: "meal", restaurant_id: "r", kind: "combo", name: "Meal", emoji: "", description: null,
  combo_price: 120, buy_qty: null, pay_qty: null, tiers: null, active: true, sort_order: 0,
  items: [{ item_id: "burger", qty: 1 }],
};
const plain = (mods: unknown): OrderLineItem => ({
  itemId: "burger", name: "forged", emoji: "", price: 0, qty: 1,
  mods: mods as OrderLineItem["mods"],
});
const bundle = (): OrderLineItem => ({
  ...plain({}), itemId: "meal", comboId: "meal",
  components: [{ itemId: "burger", name: "forged", emoji: "", qty: 99, mods: { Size: "Large" } }],
});
const run = (line: OrderLineItem, rows = [burger, cheese]) => verifyCart({
  items: [line], dbItems: rows, promotions: [promotion], isOnOpenMenu: () => true,
});

describe("G1: modifiers are menu choices, never arbitrary JSON", () => {
  it("drops a group the menu does not have, whatever it holds", () => {
    // Not refused: a group deleted while a diner's tab was open would ask them
    // to choose something no longer on the menu, and block the cart.
    const result = run(plain({ Size: "Large", surprise: { toString: "x" } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0].mods).toEqual({ Size: "Large" });
  });

  it.each([
    { Size: "Removed" }, { Size: ["Large"] }, { Size: { toString: "x" } },
    { Size: "Large", Sauces: ["Hot", { toString: "x" }] },
    { Size: "Large", Sauces: "Hot" }, { Size: "Large", Sauces: ["Removed"] },
    null, [], "Large",
  ])("refuses a malformed or removed choice: %j", mods => {
    // Null means no answer, so the required group must still be refused.
    expect(run(plain(mods))).toMatchObject({ ok: false, rejection: { kind: "missingModifiers" } });
  });

  it("rebuilds valid choices and removes duplicate multi choices", () => {
    const mods = { Size: "Large", Sauces: ["Hot", "Hot", "Mild"] };
    const result = run(plain(mods));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0].mods).toEqual({ Size: "Large", Sauces: ["Hot", "Mild"] });
    expect(result.lines[0].mods).not.toBe(mods);
    expect(result.lines[0].mods.Sauces).not.toBe(mods.Sauces);
  });

  it("validates the DB components even when the client leaves them out", () => {
    expect(run({ ...bundle(), components: [] })).toMatchObject({
      ok: false, rejection: { kind: "missingModifiers", itemId: "burger", forName: "Burger" },
    });
  });

  it("refuses malformed optional choices inside a combo", () => {
    const line = bundle();
    line.components![0].mods = { Size: "Large", Sauces: [{ toString: "x" }] } as never;
    expect(run(line)).toMatchObject({ ok: false, rejection: { kind: "missingModifiers" } });
  });
});

describe("E5: component extras agree with price, stock and paper", () => {
  const extra = { id: "cheese", name: "free forged cheese", emoji: "", price: 0 };
  it("fetches and charges a component-only extra before it reaches the ticket", () => {
    const line = bundle();
    line.components![0].extras = [extra];
    expect(cartReferences([line], [promotion])).toMatchObject({ ok: true, ids: expect.arrayContaining(["cheese"]) });
    const result = run(line);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const verified = result.lines[0];
    expect(verified.extras).toEqual([{ id: "cheese", name: "Cheese", emoji: "", price: 25 }]);
    expect(verified.components![0].extras).toEqual(verified.extras);
    expect(priceCart({ items: [verified], servicePct: 0, serviceEnabled: false }).total).toBe(145);
    expect(stockDemand([verified])).toContainEqual({ itemId: "cheese", qty: 1 });
    const ticket = kitchenTicket({ id: "12345678", items: [verified], created_at: "2026-10-20T12:00:00Z" },
      { name: "Cafe", timeZone: "UTC" }, key => key);
    expect(ticket.match(/\+ Cheese/g)).toHaveLength(1);
    expect(ticket).not.toContain("forged");
  });

  it("preserves the actual UI's duplicate copies without charging twice", () => {
    const rows = [burger, { ...burger, id: "coffee", name: "Coffee", modifiers: [] }, cheese];
    const promo = { ...promotion, items: [{ item_id: "burger", qty: 1 }, { item_id: "coffee", qty: 1 }] };
    const menu = new Map(rows.map(row => [row.id, row as unknown as MenuItem]));
    const combo = buildCombos([promo], menu)[0];
    const line = comboCartLine(combo, [
      { itemId: "burger", mods: { Size: "Large" }, extraIds: ["cheese"] },
      { itemId: "coffee", mods: {}, extraIds: ["cheese"] },
    ], menu);
    const result = verifyCart({ items: [{ ...line, qty: 2 }], dbItems: rows, promotions: [promo], isOnOpenMenu: () => true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(priceCart({ items: result.lines, servicePct: 0, serviceEnabled: false }).total).toBe(340);
    expect(stockDemand(result.lines)).toContainEqual({ itemId: "cheese", qty: 4 });
    expect(result.lines[0].components!.flatMap(part => part.extras ?? [])).toEqual(result.lines[0].extras);
  });

  it.each([{ extras: [] }, { extras: [{ ...cheese, available: false }] }])("refuses a gone component extra: %j", ({ extras }) => {
    const line = bundle();
    line.components![0].extras = [extra];
    expect(run(line, [burger, ...extras])).toMatchObject({
      ok: false, rejection: { kind: "removedExtras", ids: ["cheese"] },
    });
  });

  it("keeps legacy parent-only extras on the ticket too", () => {
    const result = run({ ...bundle(), extras: [extra] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lines[0].components![0].extras).toEqual(result.lines[0].extras);
  });

  it("can retry a combo after the cart removes a vanished extra from both views", () => {
    const line = { ...bundle(), extras: [extra], cartId: 42 };
    line.components![0].extras = [extra];
    const cleaned = removeLineExtras(line, new Set(["cheese"]));
    expect(cleaned.cartId).toBe(42);
    expect(cleaned.components![0].extras).toBeUndefined();
    expect(cleaned.extras).toBeUndefined();
    expect(run(cleaned, [burger]).ok).toBe(true);
    expect(line.components![0].extras).toEqual([extra]);
  });
});
