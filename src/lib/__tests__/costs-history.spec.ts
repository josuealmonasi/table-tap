import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: {} as Record<string, object[]> }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    let offset = 0;
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq", "is", "in", "gte", "order", "or"]) q[key] = () => q;
    q.range = (from: number) => { offset = from; return q; };
    const result = () => ({ data: table === "restaurants" ? { purchase_cover_days: 7 } : (state.rows[table] ?? []).slice(offset), error: null });
    q.single = async () => result();
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  },
}) }));
const { readStock } = await import("@/lib/costs/stock-server");
const at = (day: number) => `2026-10-${day}T12:00:00.000Z`;
const dish = { itemId: "dish", name: "Dish", emoji: "", price: 50, qty: 10, mods: {} };
const movement = (id: number, quantity: number, kind: string) => ({ id, ingredient_id: "flour", quantity, kind, created_at: at(20) });

beforeEach(() => {
  state.rows = {
    ingredients: [{ id: "flour", name: "Flour", unit: "g", pack_size: 1000, pack_price: 20, unit_cost: 0.02, lead_days: 2 }],
    recipe_lines: [{ item_id: "dish", ingredient_id: "flour", quantity: 20, mod_label: null, mod_option: null }],
    menu_items: [{ id: "dish", modifiers: [] }],
    ingredient_counts: [{ ingredient_id: "flour", counted: 1000, expected: null, counted_by: "owner", created_at: at(19), movement_cutoff: 0 }],
  };
});

describe("J12 ingredient history", () => {
  it("keeps 800 g after ten 20 g dishes when the recipe becomes 30 g or is removed", async () => {
    state.rows.orders = [{ items: [dish], created_at: at(20) }];
    state.rows.ingredient_movements = [movement(1, -200, "sale")];
    expect((await readStock("r", new Date(at(21)))).onHand.flour).toBe(800);
    state.rows.recipe_lines = [{ ...state.rows.recipe_lines[0], quantity: 30 }];
    expect((await readStock("r", new Date(at(21)))).onHand.flour).toBe(800);
    state.rows.recipe_lines = [];
    expect((await readStock("r", new Date(at(21)))).onHand.flour).toBe(800);
  });

  it("keeps two wasted 20 g dishes at 40 g after a 30 g recipe edit", async () => {
    state.rows.waste_entries = [{ ingredient_id: null, item_id: "dish", quantity: 2, reason: "unsold", cost: 0.8, created_at: at(20) }];
    state.rows.ingredient_movements = [movement(1, -40, "waste")];
    state.rows.recipe_lines = [{ ...state.rows.recipe_lines[0], quantity: 30 }];
    expect((await readStock("r", new Date(at(21)))).onHand.flour).toBe(960);
  });

  it("adds new 30 g sales without changing the old ten dishes", async () => {
    state.rows.recipe_lines = [{ ...state.rows.recipe_lines[0], quantity: 30 }];
    state.rows.ingredient_movements = [movement(1, -200, "sale"), movement(2, -30, "sale")];
    expect((await readStock("r", new Date(at(21)))).onHand.flour).toBe(770);
  });

  it("applies a cancellation and waste taken back after the count as later adjustments", async () => {
    state.rows.ingredient_counts = [{ ingredient_id: "flour", counted: 1000, movement_cutoff: 4, created_at: at(20) }];
    state.rows.ingredient_movements = [movement(3, -200, "sale"), movement(4, -40, "waste"),
      movement(5, 200, "sale"), movement(6, 40, "waste")];
    expect((await readStock("r", new Date(at(21)))).onHand.flour).toBe(1240);
  });

  it("keeps legacy counts on their date boundary and never invents an uncounted quantity", async () => {
    state.rows.ingredient_counts = [{ ingredient_id: "flour", counted: 1000, movement_cutoff: null, created_at: at(19) }];
    state.rows.ingredient_movements = [movement(1, -200, "sale"), { ...movement(2, 1000, "purchase"), created_at: at(18) }];
    expect((await readStock("r", new Date(at(21)))).onHand.flour).toBe(800);
    state.rows.ingredient_counts = [];
    expect((await readStock("r", new Date(at(21)))).onHand.flour).toBeNull();
  });

  it("uses the cutoff even when a later movement has an earlier transaction timestamp", async () => {
    state.rows.ingredient_counts = [{ ingredient_id: "flour", counted: 1000, movement_cutoff: 2, created_at: at(20) }];
    state.rows.ingredient_movements = [movement(2, -200, "sale"), { ...movement(3, 1000, "purchase"), created_at: at(19) }];
    expect((await readStock("r", new Date(at(21)))).onHand.flour).toBe(2000);
  });
});
