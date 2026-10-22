import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const id = "00000000-0000-4000-8000-000000000001";
const ref = "00000000-0000-4000-8000-000000000002";
const newer = "00000000-0000-4000-8000-000000000003";
const state = vi.hoisted(() => ({ current: "", rows: new Map<string, unknown>(), calls: [] as Record<string, unknown>[], movement: 0 }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r", role: "owner", email: "owner" }), actingManager: async () => ({ restaurantId: "r", role: "owner", email: "owner" }) }));
vi.mock("@/lib/costs/guard", async original => ({ ...await original<typeof import("@/lib/costs/guard")>(), costsBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/cash-shift-server", () => ({ openShift: async () => state.current ? { id: state.current } : null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { name: "Milk", unit_cost: 1 } }) }; return q;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    name = name.replace(/_once$/, "");
    state.calls.push({ name, ...args });
    const key = args.p_ref ? `${name}:${args.p_shift ?? ""}:${args.p_ref}` : crypto.randomUUID();
    if (state.rows.has(key)) return { data: state.rows.get(key), error: null };
    if (name === "close_cash_shift" && args.p_shift !== state.current) return { data: null, error: null };
    const data = name === "record_ingredient_counts" ? [{ ingredient_id: id, counted: 1000, expected: 1000 + state.movement, movement_cutoff: state.movement }]
      : name === "create_cash_withdrawal" ? { id: crypto.randomUUID(), currency: "MXN" }
      : name === "close_cash_shift" ? { id: args.p_shift, counted: args.p_counted, expected: 100, difference: 0, currency: "MXN" }
      : crypto.randomUUID();
    state.rows.set(key, data);
    if (name === "close_cash_shift") state.current = "";
    return { data, error: null };
  },
}) }));
const purchases = await import("@/app/api/costs/purchases/route");
const waste = await import("@/app/api/costs/waste/route");
const counts = await import("@/app/api/costs/counts/route");
const drawer = await import("@/app/api/cash-drawer/route");
const shifts = await import("@/app/api/cash-shift/route");
const req = (body: object) => new NextRequest("https://test/api", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { state.current = id; state.rows.clear(); state.calls = []; state.movement = 0; });
it("K5 a withdrawal retry returns its first movement even after a new shift opens", async () => {
  const body = { kind: "withdrawal", amount: 20, shiftId: id, ref };
  const first = await (await drawer.POST(req(body))).json();
  state.current = newer;
  const second = await (await drawer.POST(req(body))).json();
  expect(second).toEqual(first); expect(state.rows.size).toBe(1);
});
it.each([
  ["purchase", purchases.POST, { ingredientId: id, packs: 1, total: 20, ref }],
  ["waste", waste.POST, { ingredientId: id, quantity: 20, reason: "spoiled", ref }],
] as const)("K6 %s records the real write once and returns its id on retry", async (_name, post, body) => {
  const first = await post(req(body)); expect(first.status).toBe(200);
  const second = await post(req(body)); expect(second.status).toBe(200);
  expect(await second.json()).toEqual(await first.json()); expect(state.rows.size).toBe(1);
});
it("K6 retrying a count after a delivery keeps its original answer and cutoff", async () => {
  const body = { counts: [{ ingredientId: id, counted: 1000 }], ref };
  const first = await (await counts.POST(req(body))).json();
  state.movement = 1000;
  expect(await (await counts.POST(req(body))).json()).toEqual(first);
  expect(state.rows.size).toBe(1);
});
it("K9 retries the reviewed close without closing the newer shift", async () => {
  const body = { action: "close", shiftId: id, ref, counted: 100, confirm: true };
  const first = await shifts.POST(req(body)); expect(first.status).toBe(200);
  state.current = newer;
  const second = await shifts.POST(req(body)); expect(second.status).toBe(200);
  expect(await second.json()).toEqual(await first.json()); expect(state.current).toBe(newer);
});
it("K9 refuses a stale reviewed shift before touching the newer drawer", async () => {
  state.current = newer;
  const res = await shifts.POST(req({ action: "close", shiftId: id, ref, counted: 100, confirm: true }));
  expect(res.status).toBe(409); expect(await res.json()).toEqual({ error: "apiErr.shiftChanged" });
  expect(state.current).toBe(newer); expect(state.rows.size).toBe(0);
});
