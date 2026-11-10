import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: {} as Record<string, object[]> }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    let offset = 0;
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq", "neq", "is", "in", "gte", "order"]) q[key] = () => q;
    q.range = (from: number) => { offset = from; return q; };
    const result = () => ({ data: table === "restaurants" ? { currency: "MXN", tax_pct: 0, terminal_fee_pct: 0 } : (state.rows[table] ?? []).slice(offset), error: null });
    q.single = async () => result();
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  },
}) }));
vi.mock("@/lib/report-fees", () => ({ feesKeptSince: async () => ({ kept: 0, unverified: 0 }) }));
const { readCosts } = await import("@/lib/costs/server");

beforeEach(() => {
  state.rows = {
    ingredients: [{ id: "flour", name: "Flour", unit: "g", pack_size: 1000, pack_price: 100, unit_cost: 0.1 }],
    recipe_lines: [{ item_id: "dish", ingredient_id: "flour", quantity: 30, mod_label: null, mod_option: null }],
    menu_items: [{ id: "dish", name: "Dish", price: 100, modifiers: [] }],
    orders: [{ id: "sale", currency: "MXN", total: 100, service_fee: 0, tip: 0, tax_pct: 0,
      items: [{ itemId: "dish", name: "Dish", price: 100, qty: 1, mods: {} }] }],
    ingredient_consumption: [{ source_id: "sale", source_kind: "sale", cost_currency: "MXN", line_costs: [0.4] }],
  };
});

it("R7-3 keeps the consumed 20 g at its saved 0.02 cost after a recipe and supplier edit", async () => {
  const view = await readCosts("r");
  expect(view.margins[0].cost).toBe(3);
  expect(view.period.cost).toBe(0.4);
  state.rows.recipe_lines = [];
  state.rows.ingredients = [];
  expect((await readCosts("r")).period.cost).toBe(0.4);
});

it("R7-3 marks a sale without saved valuation incomplete instead of using today's recipe", async () => {
  state.rows.ingredient_consumption = [{ source_id: "sale", usage: { flour: -20 } }];
  const { period } = await readCosts("r");
  expect(period.rows[0].complete).toBe(false);
  expect(period.uncosted).toBe(100);
  expect(period.cost).toBe(0);
});

it("R7-3 never relabels a saved cost in another currency", async () => {
  state.rows.ingredient_consumption = [{ source_id: "sale", cost_currency: "USD", line_costs: [0.4] }];
  expect((await readCosts("r")).period.rows[0].complete).toBe(false);
});
