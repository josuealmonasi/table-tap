import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], error: false }));
const item = "6b1f0c2e-0000-4000-8000-000000000001";
const extra = "6b1f0c2e-0000-4000-8000-000000000002";
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r", email: "cook" }), actingManager: async () => null }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number) => Response.json({ key }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    let offset = 0;
    let selectedId = "";
    let addonOnly = false;
    const q: Record<string, unknown> = {};
    for (const key of ["select", "in", "order", "is"]) q[key] = () => q;
    q.eq = (key: string, value: string | boolean) => { if (key === "id") selectedId = String(value); if (key === "is_addon") addonOnly = value === true; return q; };
    q.range = (from: number) => { offset = from; return q; };
    const product = { id: item, name: "Latte", price: 60, is_addon: false,
      modifiers: [{ label: "Milk", type: "single", options: ["Whole", "Oat"], required: true }] };
    const rows: Record<string, object[]> = {
      menu_items: [product, { id: extra, name: "Shot", price: 10, is_addon: true, modifiers: [] }],
      item_addons: [{ addon_id: extra }],
      recipe_lines: [
        { item_id: item, ingredient_id: "milk", quantity: 200, mod_label: "Milk", mod_option: "Whole" },
        { item_id: item, ingredient_id: "oat", quantity: 200, mod_label: "Milk", mod_option: "Oat" },
        { item_id: extra, ingredient_id: "coffee", quantity: 10, mod_label: null, mod_option: null },
      ],
      ingredients: [{ id: "milk", unit_cost: 0.03 }, { id: "oat", unit_cost: 0.07 }, { id: "coffee", unit_cost: 0.4 }],
      waste_entries: [{ name: "Latte" }],
    };
    const result = (single = false) => ({ data: single ? table === "menu_items" ? rows[table].find(r => (r as { id: string }).id === selectedId) : rows[table]?.[0] : (table === "menu_items" && addonOnly ? rows[table].filter(r => (r as { is_addon: boolean }).is_addon) : rows[table] ?? []).slice(offset), error: state.error ? { message: "offline" } : null });
    q.maybeSingle = async () => result(true);
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  },
  rpc: async (_: string, args: Record<string, unknown>) => { state.calls.push(args); return { data: "waste", error: null }; },
}) }));
const { POST } = await import("@/app/api/costs/waste/route");
const waste = (over: object = {}) => POST(new NextRequest("http://localhost/api/costs/waste", {
  method: "POST", body: JSON.stringify({ itemId: item, quantity: 2, reason: "unsold", mods: { Milk: "Oat" }, extras: [extra], ...over }),
}));
beforeEach(() => { state.calls = []; state.error = false; });

it("R7-6 values two wasted oat lattes and their shots, and sends the actual choices", async () => {
  expect((await waste()).status).toBe(200);
  expect(state.calls[0]).toMatchObject({ p_cost: 36, p_choices: { mods: { Milk: "Oat" }, extras: [{ id: extra }] } });
});
it.each([{ mods: {} }, { mods: { Milk: "Invented" } }, { extras: [item] }, { extras: [extra, extra] }])(
  "R7-6 refuses missing or invalid product choices before recording: %j", async over => {
    expect((await waste(over)).status).toBe(400);
    expect(state.calls).toEqual([]);
  },
);
it("R7-6 does not record waste after a failed ingredient read", async () => {
  state.error = true;
  expect((await waste()).status).toBe(503);
  expect(state.calls).toEqual([]);
});
