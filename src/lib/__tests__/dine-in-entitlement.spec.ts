import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const insert = vi.fn();
vi.mock("@/lib/table-membership", () => ({ tableMember: async () => ({ id: "member", sessionId: "s" }) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: { allows_online_ordering: true, allows_dine_in: false } }) }));
vi.mock("@/lib/table-guard", () => ({ tableOf: async () => ({ id: "00000000-0000-4000-8000-0000000000f4" }) }));
vi.mock("@/lib/checkout/orderable-now", () => ({ orderableNow: async () => ({ closedNow: false }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const q = { select: () => q, eq: () => q, limit: async () => ({ data: [] }),
    single: async () => ({ data: table === "restaurants" ? { accepting_orders: true } : { id: "00000000-0000-4000-8000-0000000000f4", label: "1" } }),
    insert: (...args: unknown[]) => { insert(...args); return Promise.resolve({ error: null }); },
  }; return q;
} }) }));
const { POST: checkout } = await import("@/app/api/checkout/route");
const { POST: request } = await import("@/app/api/service-requests/route");
const req = (body: object) => new NextRequest("https://test/api", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => insert.mockClear());
it("D10 refuses a new prepaid table order without dine-in before reserving anything", async () => {
  const response = await checkout(req({ restaurantId: "r1", tableId: "00000000-0000-4000-8000-0000000000f4", items: [{ id: "i1", qty: 1 }] }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "plan.needs.dineIn" });
  expect(insert).not.toHaveBeenCalled();
});
it("D10 refuses waiter calls without dine-in", async () => {
  expect((await request(req({ restaurantId: "r1", tableId: "00000000-0000-4000-8000-0000000000f4", kind: "waiter" }))).status).toBe(403);
  expect(insert).not.toHaveBeenCalled();
});
it.each(["bill", "pay"])("D10 preserves %s requests for existing debts", async kind => {
  expect((await request(req({ restaurantId: "r1", tableId: "00000000-0000-4000-8000-0000000000f4", kind }))).status).toBe(200);
  expect(insert).toHaveBeenCalledOnce();
});
