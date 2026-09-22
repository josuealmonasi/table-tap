import { describe, expect, it } from "vitest";
import { comboReachProblem } from "@/lib/combo-reach";
import { buildCombos, type PromotionWithItems } from "@/lib/promotions";
import type { Category, MenuItem } from "@/lib/types";

/**
 * `comboReachProblem` tells an owner why a combo is not reaching diners, and
 * `buildCombos` is what actually drops it from the menu. The warning exists
 * because the dashboard once showed a combo as active that never rendered.
 * So the two must agree: whenever the menu drops a combo, the owner is told
 * why, and whenever the owner is told nothing is wrong, the menu shows it.
 */
const item = (id: string, over: Partial<MenuItem> = {}): MenuItem =>
  ({
    id, name: `Dish ${id}`, emoji: "🍽️", price: 50, available: true,
    category_id: "cat-live", discount_pct: 0, ...over,
  }) as MenuItem;

const categories = new Map<string, Category>([
  ["cat-live", { id: "cat-live", restaurant_id: "r", menu_id: "menu-open", name: "Mains", sort_order: 0 }],
  ["cat-closed", { id: "cat-closed", restaurant_id: "r", menu_id: "menu-shut", name: "Brunch", sort_order: 1 }],
]);
const openMenus = new Set(["menu-open"]);

const combo = (itemIds: string[]): PromotionWithItems =>
  ({
    id: "combo-1", kind: "combo", name: "Lunch deal", emoji: "🎁", active: true,
    combo_price: 80, description: null, items: itemIds.map(item_id => ({ item_id, qty: 1 })),
  }) as unknown as PromotionWithItems;

/**
 * What the diner is actually shown. `buildCombos` is handed only the dishes on
 * a menu that is serving — that is its caller's contract — so the same filter
 * is applied here before asking it.
 */
function reachesDiners(promo: PromotionWithItems, all: MenuItem[]): boolean {
  const onOpenMenu = all.filter(i => {
    const menuId = i.category_id ? categories.get(i.category_id)?.menu_id : null;
    return menuId != null && openMenus.has(menuId);
  });
  return buildCombos([promo], new Map(onOpenMenu.map(i => [i.id, i]))).length === 1;
}

describe("the owner's warning agrees with the menu", () => {
  const cases: [string, MenuItem[], string[]][] = [
    ["everything available and serving", [item("a"), item("b")], ["a", "b"]],
    ["one component sold out", [item("a"), item("b", { available: false })], ["a", "b"]],
    ["one component on a menu that is not serving", [item("a"), item("b", { category_id: "cat-closed" })], ["a", "b"]],
    ["one component deleted from the menu", [item("a")], ["a", "b"]],
    ["one component in no category at all", [item("a"), item("b", { category_id: null })], ["a", "b"]],
  ];

  for (const [label, all, ids] of cases) {
    it(label, () => {
      const promo = combo(ids);
      const problem = comboReachProblem(promo, new Map(all.map(i => [i.id, i])), categories, openMenus);
      // Silent exactly when the diner sees it; speaking exactly when they do not.
      expect(problem === null).toBe(reachesDiners(promo, all));
    });
  }
});

describe("what the owner is told", () => {
  it("names the dish that breaks it, so the fix is obvious", () => {
    const all = [item("a"), item("b", { available: false, name: "Agua de jamaica" })];
    expect(comboReachProblem(combo(["a", "b"]), new Map(all.map(i => [i.id, i])), categories, openMenus))
      .toEqual({ itemName: "Agua de jamaica", reason: "unavailable" });
  });

  it("reports only the first problem, because one broken combo is one fix", () => {
    const all = [item("a", { available: false, name: "First" }), item("b", { available: false, name: "Second" })];
    expect(comboReachProblem(combo(["a", "b"]), new Map(all.map(i => [i.id, i])), categories, openMenus)?.itemName)
      .toBe("First");
  });

  it("does not crash on a component that no longer exists", () => {
    expect(comboReachProblem(combo(["gone"]), new Map(), categories, openMenus))
      .toEqual({ itemName: "", reason: "off-menu" });
  });

  it("says nothing about a promotion that is not a combo", () => {
    const bogo = { ...combo(["a"]), kind: "bogo" } as PromotionWithItems;
    expect(comboReachProblem(bogo, new Map(), categories, openMenus)).toBeNull();
  });
});
