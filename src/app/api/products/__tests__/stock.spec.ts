import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({
  actor: { restaurantId: "r", role: "manager", email: "manager" } as object | null,
  stock: 7 as number | null, epoch: 2, changes: {} as Record<string, unknown>,
  filters: [] as [string, unknown][],
  rpc: vi.fn(), blocked: false, frozen: false, foreign: false, failRead: false,
}));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => state.actor }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({
  frozenBlocks: async () => state.frozen ? Response.json({}, { status: 402 }) : null,
  planBlocks: async () => state.blocked ? Response.json({}, { status: 403 }) : null,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const q = { update: (changes: Record<string, unknown>) => { state.changes = changes; if ("stock" in changes) state.stock = Number(changes.stock); return q; },
    eq: (key: string, value: unknown) => { state.filters.push([key, value]); return q; }, select: () => q,
    maybeSingle: async () => ({ data: state.foreign ? null : { id: "p" }, error: state.failRead ? { message: "offline" } : null }) };
  return q;
} }) }));
const { POST, PATCH } = await import("../route");
const id = "6b1f0c2e-0000-4000-8000-000000000001";
const req = (body: object, method = "POST") => new NextRequest("https://test/api/products", { method, body: JSON.stringify(body) });
beforeEach(() => {
  state.actor = { restaurantId: "r", role: "manager", email: "manager" };
  state.stock = 7; state.epoch = 2; state.changes = {}; state.filters = []; state.blocked = false; state.frozen = false; state.foreign = false; state.failRead = false;
  state.rpc.mockReset().mockImplementation(async (_name, args) => {
    if (state.foreign) return { data: "missing", error: null };
    if (args.p_expected_stock !== state.stock || args.p_expected_epoch !== state.epoch) return { data: "changed", error: null };
    state.stock = args.p_stock; state.epoch++;
    return { data: "counted", error: null };
  });
});
it("J5: an unrelated edit leaves the seven unsold portions untouched, even with a stale field", async () => {
  expect((await PATCH(req({ id, changes: { description: "New", stock: 10, stock_epoch: 0, restaurant_id: "other" } }, "PATCH"))).status).toBe(200);
  expect(state.stock).toBe(7);
  expect(state.changes).toEqual({ description: "New" });
  expect(state.filters).toEqual([["id", id], ["restaurant_id", "r"], ["is_addon", false]]);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("refuses a stale count without changing stock", async () => {
  const res = await POST(req({ id, stock: 12, expectedStock: 10, expectedEpoch: 2 }));
  expect(res.status).toBe(409); expect(await res.json()).toEqual({ error: "menu.stockChanged" });
  expect(state.stock).toBe(7); expect(state.epoch).toBe(2);
});
it("J6: refuses a matching count from a superseded generation", async () => {
  expect((await POST(req({ id, stock: 12, expectedStock: 7, expectedEpoch: 1 }))).status).toBe(409);
  expect(state.stock).toBe(7);
});
it.each([5, null, 7])("recounts %s against the opening count and generation", async stock => {
  expect((await POST(req({ id, stock, expectedStock: 7, expectedEpoch: 2 }))).status).toBe(200);
  expect(state.stock).toBe(stock); expect(state.epoch).toBe(3);
  expect(state.rpc).toHaveBeenCalledWith("recount_stock", {
    p_restaurant: "r", p_item: id, p_stock: stock, p_expected_stock: 7, p_expected_epoch: 2,
  });
});
it.each([{ stock: -1 }, { stock: 1.5 }, { stock: "5" }, { stock: 2147483648 }, { expectedStock: undefined }, { expectedEpoch: undefined }])("refuses invalid or missing recount values: %j", async invalid => {
  expect((await POST(req({ id, stock: 5, expectedStock: 7, expectedEpoch: 2, ...invalid }))).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("does not expose another restaurant's product", async () => {
  state.foreign = true;
  expect((await POST(req({ id, stock: 5, expectedStock: 7, expectedEpoch: 2 }))).status).toBe(404);
  expect((await PATCH(req({ id, changes: { description: "New" } }, "PATCH"))).status).toBe(404);
});
it("refuses a caller without management access before reading or writing", async () => {
  state.actor = null;
  expect((await POST(req({ id, stock: 5, expectedStock: 7, expectedEpoch: 2 }))).status).toBe(403);
  expect((await PATCH(req({ id, changes: { description: "New" } }, "PATCH"))).status).toBe(403);
  expect(state.rpc).not.toHaveBeenCalled(); expect(state.changes).toEqual({});
});
it("refuses frozen edits and a recount without inventory entitlement", async () => {
  state.blocked = true;
  expect((await POST(req({ id, stock: 5, expectedStock: 7, expectedEpoch: 2 }))).status).toBe(403);
  state.frozen = true;
  expect((await PATCH(req({ id, changes: { description: "New" } }, "PATCH"))).status).toBe(402);
  expect(state.rpc).not.toHaveBeenCalled(); expect(state.changes).toEqual({});
});
it("never announces a database failure as a saved count", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
  expect((await POST(req({ id, stock: 5, expectedStock: 7, expectedEpoch: 2 }))).status).toBe(503);
  expect(state.stock).toBe(7);
});
it("never announces a failed product edit as saved", async () => {
  state.failRead = true;
  expect((await PATCH(req({ id, changes: { description: "New" } }, "PATCH"))).status).toBe(503);
  expect(state.stock).toBe(7);
});
