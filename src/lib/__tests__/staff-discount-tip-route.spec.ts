import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const f = vi.hoisted(() => ({ role: "manager", calls: [] as { name: string; args: Record<string, unknown> }[], requestAmount: 100 }));
vi.mock("@/lib/api-guard", () => ({
  actingFrontOfHouse: async () => ({ restaurantId: "r", role: f.role, email: "staff" }),
  actingManager: async () => ({ restaurantId: "r", role: "manager", email: "staff" }),
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/coupon-service", () => ({ findCoupon: async () => ({ id: "coupon", code: "FREE", kind: "percent", value: 100 }),
  couponProblem: () => null, toAppliedCoupon: (c: unknown) => c }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    f.calls.push({ name, args });
    return { data: name === "apply_bill_discount" ? "applied" : "approved", error: null };
  },
  from: (table: string) => {
    let columns = "*";
    const q = { select: (v: string) => { columns = v; return q; }, eq: () => q, is: () => q, in: () => q,
      insert: async (args: Record<string, unknown>) => { f.calls.push({ name: "request", args }); return { error: null }; },
      maybeSingle: async () => ({ data: { id: "request", order_ids: ["order"], status: "pending", code: "FREE", amount: f.requestAmount }, error: null }),
      then: (done: (v: unknown) => unknown) => {
        const row: Record<string, unknown> = { id: "order", total: 120, tip: 20, paid: false, status: "received" };
        const projected = Object.fromEntries(columns.split(",").map(k => k.trim()).filter(k => k in row).map(k => [k, row[k]]));
        return Promise.resolve({ data: table === "orders" ? [projected] : [], error: null }).then(done);
      },
    }; return q;
  },
}) }));
import { POST as direct } from "@/app/api/bill/discount/route";
import { POST as approve } from "@/app/api/bill/discount/approve/route";
const req = (data: unknown) => new NextRequest("https://test/api/bill/discount", { method: "POST", body: JSON.stringify(data) });
beforeEach(() => { f.calls = []; f.role = "manager"; f.requestAmount = 100; });
it("N2: direct manager pricing reads tip and sends a principal-only discount", async () => {
  const res = await direct(req({ orderId: "order", code: "FREE" }));
  expect(res.status).toBe(200); expect((await res.json()).amount).toBe(100);
  expect(f.calls[0]).toMatchObject({ name: "apply_bill_discount", args: { p_amount: 100 } });
});
it("N2: waiter requests and manager approvals agree on the principal-only amount", async () => {
  f.role = "waiter";
  expect((await direct(req({ orderId: "order", code: "FREE" }))).status).toBe(200);
  expect(f.calls[0]).toMatchObject({ name: "request", args: { amount: 100 } });
  expect((await approve(req({ requestId: "request", approve: true, reviewedAmount: 100 }))).status).toBe(200);
  expect(f.calls[1]).toMatchObject({ name: "approve_discount_request_v2", args: { p_amount: 100 } });
});
it("N2: an old request that discounted tips is refused as a changed quote", async () => {
  f.requestAmount = 120;
  expect((await approve(req({ requestId: "request", approve: true, reviewedAmount: 120 }))).status).toBe(409);
  expect(f.calls).toEqual([]);
});
