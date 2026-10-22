import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const id = "6b1f0c2e-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({
  before: true, purchase: 0, expected: null as number | null, counted: 0,
  cutoff: 0, calls: [] as string[], error: false, missing: false,
}));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r", email: "owner" }) }));
vi.mock("@/lib/costs/guard", () => ({ costsBlocks: async () => null, uuidOf: (v: unknown) => typeof v === "string" ? v : null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (_: string, status: number) => new Response("{}", { status }) }));
vi.mock("@/lib/costs/stock-server", () => ({ readStock: async () => ({
  ingredients: [{ id: "6b1f0c2e-0000-4000-8000-000000000001" }], onHand: { "6b1f0c2e-0000-4000-8000-000000000001": 1000 },
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => ({ insert: async (rows: { counted: number; expected: number }[]) => {
    // A delivery commits between the old readStock and insert. Its timestamp
    // is before the count, but its quantity was absent from that count's read.
    state.purchase = 1000;
    state.counted = rows[0].counted;
    state.expected = rows[0].expected;
    state.cutoff = 1;
    return { error: null };
  } }),
  rpc: async (name: string, args: { p_counts: { ingredient_id: string; counted: number }[] }) => {
    state.calls.push(name);
    if (state.error) return { data: null, error: { message: "offline" } };
    if (state.missing) return { data: null, error: null };
    if (state.before) state.purchase = 1000;
    state.expected = 1000 + state.purchase;
    state.cutoff = state.purchase ? 1 : 0;
    state.counted = args.p_counts[0].counted;
    if (!state.before) state.purchase = 1000;
    return { data: [{ ingredient_id: args.p_counts[0].ingredient_id, counted: state.counted, expected: state.expected }], error: null };
  },
}) }));
const { POST } = await import("@/app/api/costs/counts/route");
const count = () => POST(new NextRequest("http://localhost/api/costs/counts", {
  method: "POST", body: JSON.stringify({ counts: [{ ingredientId: id, counted: 1000 }] }),
}));
beforeEach(() => { Object.assign(state, { before: true, purchase: 0, expected: null, counted: 0, cutoff: 0, calls: [], error: false, missing: false }); });

it("J13 includes a racing 1,000 ml purchase in both the expected figure and the cutoff", async () => {
  const response = await count();
  expect(response.status).toBe(200);
  expect((await response.json()).results[0].expected).toBe(2000);
  expect(state.counted + (state.cutoff === 0 ? state.purchase : 0)).toBe(1000);
  expect(state.calls).toEqual(["record_ingredient_counts"]);
});
it("J13 adds the 1,000 ml purchase once when it lands after the count's cutoff", async () => {
  state.before = false;
  const response = await count();
  expect((await response.json()).results[0].expected).toBe(1000);
  expect(state.counted + (state.cutoff === 0 ? state.purchase : 0)).toBe(2000);
});
it("refuses a failed atomic count instead of reporting success", async () => {
  state.error = true;
  expect((await count()).status).toBe(500);
});
it("rejects an ingredient outside this restaurant", async () => {
  state.missing = true;
  expect((await count()).status).toBe(404);
});
