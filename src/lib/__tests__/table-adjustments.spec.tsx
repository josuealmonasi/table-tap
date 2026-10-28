import { readFileSync } from "node:fs";
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
const coverage: Record<string, number> = {};
// write_off_orders as the SQL does it: refuse a part-paid bill, then write off
// what is still open and off any account.
const rpc = async (name: string, args: Row) => {
  const ids = (args.p_orders ?? [args.p_order]) as string[];
  const paid = ids.reduce((n, id) => n + (coverage[id] ?? 0), 0);
  if (name === "retained_order_coverage") return { data: paid, error: null };
  if (paid > 0) return { data: { outcome: "part_paid", paid }, error: null };
  const done = (tables.orders ?? []).filter(o => ids.includes(o.id as string) && !o.account_id && !o.paid && !o.written_off);
  done.forEach(o => { o.written_off = true; o.status = "completed"; });
  return { data: done.length ? { outcome: "written_off", orderIds: done.map(o => o.id), amount: done.reduce((n, o) => n + Number(o.total), 0), sessions: [] } : { outcome: "nothing" }, error: null };
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: (table: string) => {
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
  for (const id of Object.keys(coverage)) delete coverage[id];
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
    expect(await applyWriteOff({ orders: [{ id: "yesterday" }] as never, restaurantId: "r1", actorEmail: "ana", reason: "walkout", note: "" }))
      .toEqual({ outcome: "nothing" });
    expect(tables.orders[1].written_off).toBe(false);
    // The rule lives in the function now, under the money lock.
    const fn = readFileSync("supabase/schema.sql", "utf8").split("create or replace function public.write_off_orders(")[1]!.split("end; $$;")[0]!;
    expect(fn).toContain("and account_id is null");
    expect(fn).toContain("perform public.lock_restaurant_money(p_restaurant);");
    expect(fn).toContain("retained_order_coverage(p_restaurant, id)");
  });
});

describe("a part-paid bill is not written off (paths audit #5)", () => {
  it("refuses a manager's write-off and writes nothing", async () => {
    actor.role = "manager";
    coverage.today = 30;
    const res = await writeOff.POST(request({ tableId: "t1", reason: "walkout" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("apiErr.writeOffPartPaid");
    expect(tables.orders[0].written_off).toBe(false);
  });
  it("refuses a waiter's ask instead of storing one nobody can approve", async () => {
    coverage.today = 30;
    expect((await writeOff.POST(request({ tableId: "t1", reason: "walkout" }))).status).toBe(409);
    expect(tables.write_off_requests).toEqual([]);
  });
  it("writes off an unpaid bill and reports what the database wrote off", async () => {
    actor.role = "manager";
    const res = await writeOff.POST(request({ tableId: "t1", reason: "walkout" }));
    expect(await res.json()).toEqual({ ok: true, amount: 50 });
    expect(tables.orders[0].written_off).toBe(true);
  });
});
