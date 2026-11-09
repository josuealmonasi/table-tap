import { beforeEach, describe, expect, it, vi } from "vitest";
import { orderableNow } from "@/lib/checkout/orderable-now";
import { currentOfflinePrice } from "@/lib/offline-pricing";
import { verifiedLines } from "@/lib/checkout/verified-lines";
import type { PromotionWithItems } from "@/lib/promotions";
import type { OrderLineItem } from "@/lib/types";

vi.mock("@/lib/plan-server", () => ({ tierIncludes: async () => true }));
vi.mock("@/lib/promotions-on-sale", () => ({ promotionsOnSale: async () => [] }));
const dish = {
  id: "burger", name: "Burger", emoji: "", price: 100, available: true,
  discount_pct: 0, modifiers: [], category_id: "dinner-section", menu_id: "dinner", is_addon: false,
  item_addons: [{ addon_id: "cheese" }],
};
let rows: Record<string, unknown>[];
let readError: boolean;
const scopes: unknown[][] = [];
const db = {
  from(table: string) {
    let columns = "";
    const answer = () => {
      const data = table === "menus" ? [
        { id: "lunch", active: false, schedule: null }, { id: "dinner", active: true, schedule: null },
      ] : table === "restaurants" ? { timezone: "UTC" }
        : table === "categories" ? [{ id: "dinner-section", menu_id: "dinner" }]
          : rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => columns.includes(key))));
      return { data, error: readError && table === "menu_items" ? { message: "down" } : null };
    };
    const q = {
      select: (value: string) => { columns = value; return q; },
      eq: (...args: unknown[]) => { scopes.push([table, ...args]); return q; },
      in: () => q, single: async () => answer(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
    };
    return q;
  },
} as unknown as Parameters<typeof verifiedLines>[0];
const extra = { id: "cheese", name: "Cheese", emoji: "", price: 0 };
const line: OrderLineItem = { itemId: "burger", name: "Burger", emoji: "", price: 0, qty: 1, mods: {}, extras: [extra] };
const promo: PromotionWithItems = {
  id: "meal", restaurant_id: "r", name: "Meal", emoji: "", description: null, kind: "combo",
  combo_price: 120, buy_qty: null, pay_qty: null, tiers: null, active: true, sort_order: 0,
  items: [{ item_id: "burger", qty: 1 }, { item_id: "coffee", qty: 1 }],
};
async function verify(items = [line], promotions: PromotionWithItems[] = []) {
  const { onOpenMenu } = await orderableNow(db, "r");
  return verifiedLines(db, "r", { items, promotions, onOpenMenu });
}
beforeEach(() => {
  rows = [dish, { ...dish, id: "cheese", name: "Cheese", price: 20, is_addon: true, category_id: null }];
  readError = false;
  scopes.length = 0;
});

describe("extras on the same verified cart used by checkout and POS", () => {
  it("refuses a closed-lunch steak smuggled onto dinner as an extra", async () => {
    rows[1] = { ...rows[1], name: "Lunch steak", menu_id: "lunch", is_addon: false,
      modifiers: [{ label: "Doneness", type: "single", options: ["Rare"], required: true }] };
    expect(await verify()).toMatchObject({ ok: false, rejection: { kind: "removedExtras", ids: ["cheese"] } });
  });
  describe.each(["plain", "combo parent", "combo component"])("%s extras", placement => {
    it.each([
      { item_addons: [] },
      { is_addon: false },
      { menu_id: "lunch" },
      { available: false },
      { modifiers: [{ label: "Size", type: "single", options: ["Large"], required: true }] },
    ])("refuses an extra whose saved rules no longer allow it: %j", async change => {
      if ("item_addons" in change) rows[0] = { ...dish, ...change };
      else rows[1] = { ...rows[1], ...change };
      const sent = placement === "plain" ? line : { ...line, itemId: "meal", comboId: "meal",
        ...(placement === "combo component" ? { extras: [], components: [
          { itemId: "burger", name: "Burger", emoji: "", qty: 1, mods: {}, extras: [extra] },
        ] } : {}),
      };
      if (placement !== "plain") rows.push({ ...dish, id: "coffee", item_addons: [] });
      expect(await verify([sent], placement === "plain" ? [] : [promo]))
        .toMatchObject({ ok: false, rejection: { kind: "removedExtras" } });
    });
  });
  it("keeps an open, linked extra at its saved price", async () => {
    const result = await verify();
    expect(result.ok && result.lines[0].extras).toEqual([{ ...extra, price: 20 }]);
    expect(scopes).toContainEqual(["menu_items", "restaurant_id", "r"]);
  });
  it("cannot price a cart when the saved rules cannot be read", async () => {
    readError = true;
    expect(await verify()).toEqual({ ok: false, rejection: null });
  });
  it("checks each combo extra against its own plate, even if another plate offers it", async () => {
    rows.push({ ...dish, id: "coffee", name: "Coffee", item_addons: [] });
    const bundle = { ...line, itemId: "meal", comboId: "meal", components: [
      { itemId: "coffee", name: "Coffee", emoji: "", qty: 1, mods: {}, extras: [extra] },
    ] };
    expect(await verify([bundle], [promo])).toMatchObject({ ok: false, rejection: { kind: "removedExtras" } });
  });
  it("gives a legacy parent-only extra to a plate that actually offers it", async () => {
    rows[0] = { ...dish, item_addons: [] };
    rows.push({ ...dish, id: "coffee", name: "Coffee" });
    const result = await verify([{ ...line, itemId: "meal", comboId: "meal" }], [promo]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines[0].components?.[0].extras).toBeUndefined();
      expect(result.lines[0].components?.[1].extras).toEqual([{ ...extra, price: 20 }]);
    }
  });
});

describe("an item's own menu decides whether it can be sold", () => {
  it.each([null, "dinner-section"])("refuses a closed-menu dish with category %s", async category => {
    rows[0] = { ...dish, menu_id: "lunch", category_id: category };
    expect(await verify([{ ...line, extras: [] }])).toMatchObject({ ok: false, rejection: { kind: "unavailable" } });
  });
  it("lets an uncategorized dish from an open menu through", async () => {
    rows[0] = { ...dish, category_id: null };
    expect((await verify([{ ...line, extras: [] }])).ok).toBe(true);
  });
  it("checks the own menu of every combo plate", async () => {
    rows.push({ ...dish, id: "coffee", menu_id: "lunch", category_id: null });
    expect(await verify([{ ...line, itemId: "meal", comboId: "meal", extras: [] }], [promo]))
      .toMatchObject({ ok: false, rejection: { kind: "unavailable" } });
  });
});


it("still prices an already-collected offline sale after its linked extra sold out and lunch closed", async () => {
  rows = rows.map(row => ({ ...row, available: false, menu_id: "lunch" }));
  const result = await currentOfflinePrice(db, "r", { items: [line] }, { service_pct: 0, service_enabled: false });
  expect(result?.price.total).toBe(120);
  expect(result?.lines[0].extras).toEqual([{ ...extra, price: 20 }]);
});
