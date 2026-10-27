import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { messagesFor, translate, type Locale } from "@/lib/i18n";

const rpc = vi.fn();
const billing = vi.fn();
const deleteUser = vi.fn();
let locale: Locale = "en";
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => locale }));
vi.mock("@/lib/admin", () => ({ getPlatformAdmin: async () => ({ email: "admin@test.dev" }) }));
vi.mock("@/lib/admin-audit", () => ({ auditedAdminAction: (_action: string, handler: unknown) => handler }));
vi.mock("@/lib/admin-plan", () => ({ moveRestaurantPlan: vi.fn() }));
vi.mock("@/lib/billing-delete", () => ({ endRestaurantBilling: (...args: unknown[]) => billing(...args) }));
vi.mock("@/lib/billing-operation", () => ({
  withRestaurantBilling: async (_db: unknown, _id: string, action: (op: unknown) => unknown) =>
    action({ write: async (fn: () => unknown) => fn(), record: async () => {} }),
  billingFailure: async () => NextResponse.json({ error: "failed" }, { status: 502 }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc, auth: { admin: { deleteUser } },
  from: () => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: { state: {} }, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [{ user_id: "staff1" }], error: null }).then(resolve),
    };
    return q;
  },
}) }));
const { DELETE } = await import("@/app/api/admin/restaurants/route");
const run = () => DELETE(new NextRequest("https://tabletap.test/api/admin/restaurants", {
  method: "DELETE", body: JSON.stringify({ id: "r1" }),
}));
const sql = readFileSync("supabase/schema.sql", "utf8");
const body = sql.split("create or replace function public.admin_delete_restaurant(")[1]?.split("$$;")[0] ?? "";

beforeEach(() => {
  vi.clearAllMocks(); locale = "en";
  deleteUser.mockResolvedValue({ error: null });
});

it("checks all four refund clocks for this restaurant under both locks before checking or deleting", () => {
  const query = body.match(/select max\(refunded_at\) \+ interval '30 days'[\s\S]*?\) refunds;/)?.[0] ?? "";
  expect(query).toContain("into v_refund_unlock_at");
  expect(query).toMatch(/select completed_at as refunded_at from refund_operations\s+where restaurant_id = p_restaurant and source = 'stripe' and status = 'succeeded'/);
  expect(query).toMatch(/select refunded_at from refunds_due\s+where restaurant_id = p_restaurant and refunded_at is not null/);
  for (const table of ["refund_attempts", "refund_due_attempts"]) {
    expect(query).toMatch(new RegExp(`select updated_at as refunded_at from ${table}\\s+where restaurant_id = p_restaurant and provider_status = 'succeeded'`));
  }
  expect(query.match(/union all/g)).toHaveLength(3);
  expect(body.indexOf(query)).toBeGreaterThan(body.indexOf("lock_restaurant_money(p_restaurant)"));
  expect(body.indexOf(query)).toBeGreaterThan(body.indexOf("for update"));
  expect(body).toContain("if v_refund_unlock_at > now() then");
  const refusal = body.indexOf("'outcome', 'refundWindow', 'unlock_at', v_refund_unlock_at");
  expect(refusal).toBeGreaterThan(body.indexOf(query));
  expect(refusal).toBeLessThan(body.indexOf("if p_check_only"));
  expect(refusal).toBeLessThan(body.indexOf("insert into restaurant_accounting_records"));
});

// SQL age selection is pinned above; these are mocked RPC outcomes, not a
// live Postgres replay. A 29-day refund is held; a 31-day one is clear.
it.each(["MXN", "USD"])("maps a 29-day %s refund refusal before touching billing or staff", async currency => {
  const unlock = "2026-10-28T14:30:00+00:00";
  rpc.mockResolvedValue({ data: { outcome: "refundWindow", unlock_at: unlock, currency }, error: null });
  const response = await run();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    unlock_at: unlock,
    error: "Stripe can still report a recent refund as failed. Wait 30 days after the latest refund before deleting this restaurant. You can try again from Oct 28, 2026, 2:30:00 PM UTC, once no payments or refunds are pending.",
  });
  expect(billing).not.toHaveBeenCalled();
  expect(deleteUser).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(1);
});

it.each(["MXN", "USD"])("accepts a 31-day %s refund clearance when nothing else blocks", async currency => {
  rpc.mockImplementation(async (_name: string, args: { p_check_only: boolean }) => ({
    data: { outcome: args.p_check_only ? "ready" : "deleted", currency }, error: null,
  }));
  expect((await run()).status).toBe(200);
  expect(billing).toHaveBeenCalledOnce();
  expect(deleteUser).toHaveBeenCalledWith("staff1");
  expect(rpc).toHaveBeenLastCalledWith("admin_delete_restaurant", { p_restaurant: "r1", p_check_only: false });
});

it("shows the unlock time and reason in Spanish", async () => {
  locale = "es";
  rpc.mockResolvedValue({ data: { outcome: "refundWindow", unlock_at: "2026-10-28T14:30:00+00:00" }, error: null });
  const response = await run();
  expect(response.status).toBe(409);
  const { error } = await response.json();
  expect(error).toContain("Stripe todavía puede avisar que un reembolso reciente falló");
  expect(error).toContain("28 oct 2026");
  expect(error).toContain("UTC");
  expect(error).not.toContain("{date}");
});

it("also maps a new refund hold at the final atomic deletion check", async () => {
  rpc.mockResolvedValueOnce({ data: { outcome: "ready" }, error: null })
    .mockResolvedValueOnce({ data: { outcome: "refundWindow", unlock_at: "2026-11-26T12:00:00Z" }, error: null });
  expect((await run()).status).toBe(409);
  expect(deleteUser).not.toHaveBeenCalled();
});

it.each(["en", "es"] as const)("has %s copy explaining the 30-day hold and interpolating the unlock time", language => {
  const copy = translate(messagesFor(language), "apiErr.restaurantDeleteRefundWindow", { date: "UNLOCK" });
  expect(copy).toContain("30");
  expect(copy).toContain("Stripe");
  expect(copy).toContain("UNLOCK");
  expect(copy).not.toContain("{date}");
});
