import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({ frozen: false, writes: [] as string[], rpcData: "p1" as unknown, rpcError: null as { message: string } | null }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r1", email: "manager@test" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status = 400) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({
  frozenBlocks: async () => state.frozen ? NextResponse.json({ error: "frozen" }, { status: 402 }) : null,
  planBlocks: async () => null,
}));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: unknown) => {
    state.writes.push(JSON.stringify({ name, args }));
    return { data: state.rpcData, error: state.rpcError };
  },
  from: (table: string) => {
    let write = false;
    const q = {
      select: () => q, eq: () => q, in: () => q,
      insert: () => { write = true; state.writes.push(table); return q; },
      update: () => { write = true; state.writes.push(table); return q; },
      delete: () => { write = true; state.writes.push(table); return q; },
      single: async () => ({ data: { id: "p1" }, error: null }),
      // The coupon route reads the caller's coupon before editing it.
      maybeSingle: async () => ({ data: { id: "p1", code: "ABC-123" }, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({
        data: write ? [{ id: "p1" }] : [{ id: "i1", price: 100 }, { id: "i2", price: 100 }], error: null,
      }).then(resolve),
    };
    return q;
  },
}) }));
const promos = await import("@/app/api/promotions/route");
const menu = await import("@/app/api/menu/duplicate/route");
const coupons = await import("@/app/api/coupons/route");
const request = (method: string, body: unknown) => new NextRequest("https://test/api", { method, body: JSON.stringify(body) });
const offer = { id: "p1", kind: "combo", name: "Lunch", comboPrice: 50, items: [{ itemId: "i1", qty: 1 }, { itemId: "i2", qty: 1 }] };
beforeEach(() => { state.frozen = false; state.writes = []; state.rpcError = null; state.rpcData = "p1"; });

describe("J2 promotion replacement", () => {
  it("saves terms and components with one scoped transaction", async () => {
    expect((await promos.PATCH(request("PATCH", offer))).status).toBe(200);
    expect(state.writes).toHaveLength(1);
    expect(JSON.parse(state.writes[0])).toMatchObject({ name: "save_promotion_v1", args: { p_restaurant: "r1", p_id: "p1" } });
  });
  it("does not attempt a partial restore when a component fails", async () => {
    state.rpcError = { message: "foreign key refusal" };
    expect((await promos.PATCH(request("PATCH", offer))).status).toBe(500);
    expect(state.writes).toHaveLength(1);
  });
  it("creates a complete promotion in the same transaction", async () => {
    expect((await promos.POST(request("POST", offer))).status).toBe(200);
    expect(state.writes).toHaveLength(1);
    expect(JSON.parse(state.writes[0]).args.p_id).toBeNull();
  });
});

describe.each([["promotions", promos], ["coupons", coupons]] as const)("J16 frozen %s", (_name, route) => {
  beforeEach(() => { state.frozen = true; });
  it.each([true, false])("allows only a lone switch off (active=%s)", async active => {
    expect((await route.PATCH(request("PATCH", { id: "p1", active }))).status).toBe(active ? 402 : 200);
    expect(state.writes).toHaveLength(active ? 0 : 1);
  });
  it("refuses edits, including an off flag bundled with changed terms", async () => {
    expect((await route.PATCH(request("PATCH", { ...offer, active: false, value: 10 }))).status).toBe(402);
    expect(state.writes).toEqual([]);
  });
  it("refuses deletion", async () => {
    expect((await route.DELETE(request("DELETE", { id: "p1" }))).status).toBe(402);
    expect(state.writes).toEqual([]);
  });
});


describe("J14 menu copy route", () => {
  const sourceId = "00000000-0000-4000-8000-000000000001";
  it("scopes a single transaction to the manager's restaurant", async () => {
    state.rpcData = { newMenuId: "copy", copyName: "Dinner copy" };
    const response = await menu.POST(request("POST", { sourceId }));
    expect(await response.json()).toEqual(state.rpcData);
    expect(state.writes.map(s => JSON.parse(s))).toEqual([{ name: "duplicate_menu_v1", args: { p_restaurant: "r1", p_source: sourceId } }]);
  });
  it("refuses a frozen copy before any write", async () => {
    state.frozen = true;
    expect((await menu.POST(request("POST", { sourceId }))).status).toBe(402);
    expect(state.writes).toEqual([]);
  });
  it("cannot copy a missing or foreign menu", async () => {
    state.rpcData = null;
    expect((await menu.POST(request("POST", { sourceId }))).status).toBe(404);
  });
  it("reports a failed transaction without claiming a copy exists", async () => {
    state.rpcError = { message: "item insert failed" };
    expect((await menu.POST(request("POST", { sourceId }))).status).toBe(500);
    expect(state.writes).toHaveLength(1);
  });
});
