import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { unitMargin } from "@/lib/costs/margins";
import { recipeBook } from "@/lib/costs/recipe-cost";

const state = vi.hoisted(() => ({ writes: 0, recipes: [] as object[] }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r" }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number, vars?: object) => Response.json({ key, vars }, { status }) }));
const db = vi.hoisted(() => ({ rpc: async () => { state.writes++; return { data: "dish", error: null }; }, from: (table: string) => {
  let offset = 0;
  const q: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order"]) q[name] = () => q;
  q.range = (from: number) => { offset = from; return q; };
  q.update = () => { state.writes++; return q; };
  const result = () => ({ data: table === "recipe_lines" ? state.recipes.slice(offset) : { id: "dish", name: "Latte" }, error: null });
  q.maybeSingle = async () => result();
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return q;
} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
const { PATCH } = await import("@/app/api/products/route");
const recipe = { item_id: "dish", ingredient_id: "oat", quantity: 200, mod_label: "Milk", mod_option: "Oat" };
const modifiers = [{ label: "Milk", type: "single" as const, options: ["Whole"] }];
const save = (mods: unknown, addonIds?: string[]) => PATCH(new NextRequest("http://localhost/api/products", {
  method: "PATCH", body: JSON.stringify({ id: "6b1f0c2e-0000-4000-8000-000000000001", changes: { modifiers: mods }, ...(addonIds ? { addonIds } : {}) }),
}));
beforeEach(() => { state.writes = 0; state.recipes = [recipe]; });

it("R7-4 refuses a removed or renamed option and names the recipe before writing", async () => {
  const response = await save(modifiers);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ key: "apiErr.recipeModifierEdit", vars: { name: "Latte" } });
  expect(state.writes).toBe(0);
});
it("R7-4 refuses the same edit when extras are saved with the product", async () => {
  expect((await save([], [])).status).toBe(409);
  expect(state.writes).toBe(0);
});
it("allows price-only-independent choices and options the recipe still offers", async () => {
  expect((await save([{ ...modifiers[0], options: ["Whole", "Oat"] }])).status).toBe(200);
  expect(state.writes).toBe(1);
});
it("R7-4 shows an orphaned condition as incomplete in today's costing", () => {
  const margin = unitMargin({ id: "dish", name: "Latte", emoji: null, price: 60, discount_pct: 0, is_addon: false, modifiers },
    recipeBook([recipe]), new Map([["oat", 0.07]]), 0, 0);
  expect(margin.cost).toBeNull();
  expect(margin.margin).toBeNull();
});
