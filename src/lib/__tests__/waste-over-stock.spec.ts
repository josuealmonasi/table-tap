import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Low fixes 2026-11-25 #5: wasting more of a counted dish than its count was
 * clamped at 0 by the writer, and a reservation released later put units back
 * on a shelf that never had them. The route refuses it instead.
 */
const item = "6b1f0c2e-0000-4000-8000-000000000001";
const ref = "6b1f0c2e-0000-4000-8000-000000000009";
const state = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], stock: 2 as number | null, saved: false, vars: {} as unknown }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r", email: "cook" }), actingManager: async () => null }));
vi.mock("@/lib/costs/guard", async original => ({ ...await original<object>(), costsBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number, vars?: unknown) => { state.vars = vars; return Response.json({ key }, { status }); } }));
vi.mock("@/lib/costs/waste-product", () => ({ wasteProduct: async () => ({ value: { cost: null, choices: { mods: {}, extras: [] } } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq"]) q[key] = () => q;
    q.maybeSingle = async () => ({
      data: table === "menu_items" ? { stock: state.stock } : table === "waste_entries" ? (state.saved ? { id: "saved", name: "Latte" } : null) : null,
      error: null,
    });
    return q;
  },
  rpc: async (_: string, args: Record<string, unknown>) => { state.calls.push(args); return { data: "waste", error: null }; },
}) }));
const { POST } = await import("@/app/api/costs/waste/route");
const waste = (over: object = {}) => POST(new NextRequest("http://localhost/api/costs/waste", {
  method: "POST", body: JSON.stringify({ itemId: item, quantity: 3, reason: "unsold", ...over }),
}));
beforeEach(() => { state.calls = []; state.stock = 2; state.saved = false; state.vars = {}; });

it("refuses wasting more of a counted dish than its count, naming the count", async () => {
  const response = await waste();
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ key: "apiErr.wasteOverStock" });
  expect(state.vars).toEqual({ n: 2 });
  expect(state.calls).toEqual([]);
});

it("records up to the count, an uncounted dish, and a returned plate", async () => {
  expect((await waste({ quantity: 2 })).status).toBe(200);
  expect((await waste({ reason: "returned" })).status).toBe(200);
  state.stock = null;
  expect((await waste()).status).toBe(200);
  expect(state.calls).toHaveLength(3);
});

it("lets a retry of a saved entry through, whose units already left the count", async () => {
  state.stock = 0; state.saved = true;
  expect((await waste({ ref })).status).toBe(200);
  state.saved = false;
  expect((await waste({ ref })).status).toBe(400);
});

it("has the refusal in both languages", async () => {
  const [{ es }, { en }] = await Promise.all([import("@/lib/i18n/es"), import("@/lib/i18n/en")]);
  expect(es.apiErr.wasteOverStock).toContain("{n}");
  expect(en.apiErr.wasteOverStock).toContain("{n}");
});
