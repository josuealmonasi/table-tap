import { describe, expect, it } from "vitest";
import type { MenuItem } from "@/lib/types";
import type { Combo } from "@/lib/promotions";
import type { CartPromo } from "@/lib/pricing";
import { DEALS, USUAL, filterCombos, filterDishes, menuHasDeals, promoIndex } from "@/lib/menu-filter";

const dish = (id: string, over: Partial<MenuItem> = {}) =>
  ({ id, name: id, description: "", category_id: "c1", discount_pct: 0, dietary: [], ...over }) as MenuItem;
const items = [
  dish("soup", { dietary: ["vegan"] }),
  dish("steak", { category_id: "c2", discount_pct: 10 }),
  dish("salad", { dietary: ["vegan", "gf"], description: "crisp greens" }),
];
const combos = [{ id: "k1", name: "Lunch deal" }] as Combo[];
const promos = [{ name: "2x1", itemIds: ["soup"] }, { name: "later", itemIds: ["soup"] }] as CartPromo[];
const view = (over: Partial<{ search: string; activeCat: string; diet: string[] }> = {}) =>
  ({ search: "", activeCat: "all", diet: [], ...over });

describe("what the menu shows", () => {
  const { ids, nameOf } = promoIndex(promos);

  it("names a dish's offer by the first deal that covers it", () => {
    expect([...ids]).toEqual(["soup"]);
    expect(nameOf.get("soup")).toBe("2x1");
  });

  it("offers the deals tab only when there is a deal to show, and never when the owner hid it", () => {
    expect(menuHasDeals(true, [], items, ids)).toBe(true);
    expect(menuHasDeals(true, [], [dish("plain")], new Set())).toBe(false);
    expect(menuHasDeals(false, combos, items, ids)).toBe(false);
  });

  it("narrows by tab, and by search across the whole menu, names and descriptions", () => {
    const shown = (v: ReturnType<typeof view>) => filterDishes(items, v, ids, new Set(["steak"])).map(i => i.id);
    expect(shown(view({ activeCat: "c2" }))).toEqual(["steak"]);
    expect(shown(view({ activeCat: DEALS }))).toEqual(["soup", "steak"]);
    expect(shown(view({ activeCat: USUAL }))).toEqual(["steak"]);
    expect(shown(view({ activeCat: "c2", search: "GREENS" }))).toEqual(["salad"]);
  });

  it("keeps a dish only when it carries every dietary tag asked for", () => {
    expect(filterDishes(items, view({ diet: ["vegan", "gf"] }), ids, new Set()).map(i => i.id)).toEqual(["salad"]);
  });

  it("hides combos under a dietary filter or a category, and searches them by name", () => {
    expect(filterCombos(combos, view())).toHaveLength(1);
    expect(filterCombos(combos, view({ diet: ["vegan"] }))).toEqual([]);
    expect(filterCombos(combos, view({ activeCat: "c1" }))).toEqual([]);
    expect(filterCombos(combos, view({ activeCat: "c1", search: "lunch" }))).toHaveLength(1);
  });
});
