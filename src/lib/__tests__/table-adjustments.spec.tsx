import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
interface Row { [key: string]: unknown }
const tables: Record<string, Row[]> = {};
const actor = { restaurantId: "r1", email: "ana", role: "waiter" };
const applied: Row[][] = [];
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => actor, actingManager: async () => actor }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: async () => {} }));
vi.mock("@/lib/coupon-service", () => ({
  findCoupon: async () => ({ id: "c1", code: "SAVE", kind: "fixed", value: 30 }),
  couponProblem: () => null, claimCoupon: async () => true, logRedemption: async () => {},
  toAppliedCoupon: () => ({ kind: "fixed", value: 30 }),
}));
vi.mock("@/lib/apply-bill-discount", () => ({ applyToOrders: async (orders: Row[]) => { applied.push(orders); return true; } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const filters: ((r: Row) => boolean)[] = [];
  let columns = "*";
  let patch: Row | null = null;
  let inserted: Row | null = null;
  const result = () => {
    if (inserted) { (tables[table] ??= []).push(inserted); return { data: null, error: null }; }
    const hits = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
    if (patch) hits.forEach(r => Object.assign(r, patch));
    return { data: hits.map(r => columns === "*" ? r : Object.fromEntries(columns.split(",").map(k => [k.trim(), r[k.trim()]]))), error: null };
  };
  const q = {
    select: (c = "*") => { columns = c; return q; },
    eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
    neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q; },
    is: (k: string) => { filters.push(r => r[k] == null); return q; },
    in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
    update: (p: Row) => { patch = p; return q; },
    insert: (p: Row) => { inserted = p; return q; },
    maybeSingle: async () => ({ ...result(), data: result().data?.[0] ?? null }),
    single: async () => ({ ...result(), data: result().data?.[0] ?? null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return q;
} }) }));
const discount = await import("@/app/api/bill/discount/route");
const approveDiscount = await import("@/app/api/bill/discount/approve/route");
const writeOff = await import("@/app/api/bill/write-off/route");
const approveWriteOff = await import("@/app/api/bill/write-off/approve/route");
const { applyWriteOff } = await import("@/lib/apply-write-off");
const request = (body: object) => new NextRequest("https://test/api/bill", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  actor.role = "waiter";
  applied.length = 0;
  tables.orders = [
    { id: "today", restaurant_id: "r1", total: 50, table_id: "t1", paid: false, written_off: false, status: "received", account_id: null },
    { id: "yesterday", restaurant_id: "r1", total: 100, table_id: "t1", paid: false, written_off: false, status: "received", account_id: "a1" },
  ];
  tables.discount_requests = [];
  tables.write_off_requests = [];
});
describe("table adjustment routes leave account orders alone", () => {
  it("keeps account orders out of a pending discount request", async () => {
    await discount.POST(request({ tableId: "t1", code: "SAVE" }));
    expect(tables.discount_requests[0].order_ids).toEqual(["today"]);
  });
  it("keeps account orders out of a pending write-off request", async () => {
    await writeOff.POST(request({ tableId: "t1", reason: "walkout" }));
    expect(tables.write_off_requests[0].order_ids).toEqual(["today"]);
    expect(tables.write_off_requests[0].amount).toBe(50);
  });
  it("rechecks account membership when an old discount request is approved", async () => {
    actor.role = "manager";
    tables.discount_requests = [{ id: "ask", restaurant_id: "r1", status: "pending", order_ids: ["yesterday"], code: "SAVE", amount: 30 }];
    expect((await approveDiscount.POST(request({ requestId: "ask", approve: true, reviewedAmount: 30 }))).status).toBe(409);
    expect(applied).toEqual([]);
  });
  it("rechecks account membership when an old write-off request is approved", async () => {
    actor.role = "manager";
    tables.write_off_requests = [{ id: "ask", restaurant_id: "r1", status: "pending", order_ids: ["yesterday"], reason: "walkout", amount: 100 }];
    expect((await approveWriteOff.POST(request({ requestId: "ask", approve: true, reviewedAmount: 100 }))).status).toBe(409);
    expect(tables.orders[1].written_off).toBe(false);
  });
  it("cannot discount an order moved to an account after the read", async () => {
    const { applyToOrders } = await vi.importActual<typeof import("@/lib/apply-bill-discount")>("@/lib/apply-bill-discount");
    await applyToOrders([{ id: "yesterday", total: 100 }] as never, "c1", "SAVE", 30, "r1");
    expect(tables.orders[1].total).toBe(100);
  });
  it("cannot write off an order moved to an account after the read", async () => {
    await applyWriteOff({ orders: [{ id: "yesterday" }] as never, restaurantId: "r1", actorEmail: "ana", reason: "walkout", note: "" });
    expect(tables.orders[1].written_off).toBe(false);
  });
});
