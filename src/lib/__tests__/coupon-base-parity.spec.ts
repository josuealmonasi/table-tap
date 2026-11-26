import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TableBill } from "@/lib/table-bill";
import type { CouponRow } from "@/lib/coupon-service";

/**
 * Staff coupons were judged on dishes plus service, diners' on dishes alone
 * (2026-11-26). The same bill is priced here through both: the floor's
 * `bill/discount` route and the diner's bill (`billAmounts`, which the bill
 * screen and `bill/pay` share). They must agree on the minimum and the amount.
 */
interface Row { id: string; total: number; tip: number; service_fee: number }
const f = vi.hoisted(() => ({ rows: [] as Row[], calls: [] as { name: string; args: Record<string, unknown> }[] }));
const coupon: CouponRow = {
  id: "c", code: "MIN100", kind: "percent", value: 10, min_subtotal: 100, max_uses: null, uses_count: 0,
  active: true, starts_at: null, ends_at: null, staff_only: true,
};
vi.mock("@/lib/staff-request-guard", () => ({ staffWriteLimited: async () => false, repeatedStaffRequest: async () => null }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => ({ restaurantId: "r", role: "manager", email: "m" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/coupon-service", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/coupon-service")>()),
  findCoupon: async () => coupon,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => { f.calls.push({ name, args }); return { data: "applied", error: null }; },
  from: () => {
    let columns = "*";
    const q = {
      select: (v: string) => { columns = v; return q; }, eq: () => q, is: () => q, in: () => q,
      then: (done: (v: unknown) => unknown) => {
        const keep = columns.split(",").map(k => k.trim());
        const rows = f.rows.map(r => Object.fromEntries(Object.entries({ ...r, paid: false, status: "received" })
          .filter(([k]) => keep.includes(k))));
        return Promise.resolve({ data: rows, error: null }).then(done);
      },
    };
    return q;
  },
}) }));

import { POST } from "@/app/api/bill/discount/route";
import { billAmounts } from "@/lib/bill-amounts";
import { couponProblem, toAppliedCoupon } from "@/lib/coupon-service";

const sum = (rows: Row[], key: keyof Row) => rows.reduce((s, r) => s + Number(r[key]), 0);
function dinerBill(rows: Row[]): TableBill {
  const side = { orders: rows, items: [], total: sum(rows, "total"), discount: 0, service: sum(rows, "service_fee"), tip: sum(rows, "tip") };
  const empty = { orders: [], items: [], total: 0, discount: 0, service: 0, tip: 0 };
  return { mine: side, others: empty, paid: empty, total: side.total, discount: 0, service: side.service, tip: side.tip, settled: false } as unknown as TableBill;
}

async function staff(rows: Row[]): Promise<{ ok: boolean; amount: number }> {
  f.rows = rows;
  const res = await POST(new NextRequest("https://test/api/bill/discount", {
    method: "POST", body: JSON.stringify({ tableId: "t", code: coupon.code }),
  }));
  const body = await res.json();
  return { ok: res.status === 200, amount: res.status === 200 ? body.amount : 0 };
}
function diner(rows: Row[]): { ok: boolean; amount: number } {
  const a = billAmounts(dinerBill(rows), "mine", toAppliedCoupon(coupon), 0, null);
  const ok = couponProblem(coupon, a.dishes) === null;
  return { ok, amount: ok ? a.couponOff : 0 };
}

beforeEach(() => { f.calls = []; });

it.each([
  ["MX$90 of food and MX$15 of service misses a MX$100 minimum", [{ id: "a", total: 105, tip: 0, service_fee: 15 }], { ok: false, amount: 0 }],
  ["a tip and service never reach the minimum either", [{ id: "a", total: 125, tip: 20, service_fee: 10 }], { ok: false, amount: 0 }],
  ["10% is taken of the dishes only, across orders", [
    { id: "a", total: 140, tip: 10, service_fee: 15 }, { id: "b", total: 30, tip: 0, service_fee: 0 },
  ], { ok: true, amount: 14.5 }],
] as [string, Row[], { ok: boolean; amount: number }][])("staff and diner agree: %s", async (_name, rows, expected) => {
  const viaStaff = await staff(rows);
  expect(viaStaff).toEqual(diner(rows));
  expect(viaStaff).toEqual(expected);
  if (expected.ok) expect(f.calls[0]).toMatchObject({ name: "apply_bill_discount_v2", args: { p_amount: expected.amount } });
});
