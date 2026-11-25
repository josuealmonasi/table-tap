import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const rpc = vi.fn();
const resolve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/whole-bill-pages", () => ({ resolveCheckoutPages: resolve }));
const refunds = vi.fn();
const execute = vi.fn();
const previous = vi.fn();
const snapshot = {
  order: { id: "o1", paid: false, account_id: "a1", stripe_refund_id: null },
  plan: { refunds: [], handBack: [] }, hold: null as string | null, holdId: "checkout-a",
};
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r1", email: "ana" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/refunds/operations", () => ({ orderRefunds: refunds, executeOrderRefund: execute }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/legacy-stock", () => ({ legacyStockDemand: async () => [] }));
vi.mock("@/lib/cancel-read", () => ({ readCancel: async () => snapshot }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: () => { const q = { select: () => q, eq: () => q, maybeSingle: previous }; return q; } }) }));
const { POST } = await import("@/app/api/orders/cancel/route");
const cancel = () => POST(new NextRequest("https://test/api/orders/cancel", {
  method: "POST", body: JSON.stringify({ id: "o1" }),
}));
beforeEach(() => { vi.clearAllMocks(); resolve.mockReset().mockResolvedValue("unverified"); snapshot.hold = null; previous.mockResolvedValue({ data: null, error: null }); refunds.mockResolvedValue([]); });
describe("cancellation and collection agree on the plan's state", () => {
  it("passes the unpaid snapshot so collection winning the lock refuses cancellation", async () => {
    rpc.mockResolvedValue({ data: { outcome: "changed" }, error: null });
    expect((await cancel()).status).toBe(409);
    expect(rpc).toHaveBeenCalledWith("prepare_order_refund_v2", expect.objectContaining({
      p_expected_paid: false, p_expected_account: "a1", p_expected_hold: null, p_expected_checkout: "checkout-a",
    }));
    expect(execute).not.toHaveBeenCalled();
  });
  it("passes the hold read with the plan, rather than a fresh hold", async () => {
    snapshot.hold = "2026-10-01T12:00:00Z";
    rpc.mockResolvedValue({ data: { outcome: "changed" }, error: null });
    await cancel();
    expect(rpc.mock.calls[0][1].p_expected_hold).toBe(snapshot.hold);
  });
  it("commits the cancellation before attempting any provider return", async () => {
    rpc.mockResolvedValue({ data: { outcome: "cancelled", adjustment: "a1" }, error: null });
    expect((await cancel()).status).toBe(200);
    expect(refunds).toHaveBeenCalledWith("r1", "a1");
  });
});

it.each(["paying", "changed"])("cancellation retries its identical snapshot after a %s page refusal", async outcome => {
  resolve.mockResolvedValue("closed");
  rpc.mockResolvedValueOnce({ data: { outcome }, error: null })
    .mockResolvedValueOnce({ data: { outcome: "cancelled", adjustment: "a1" }, error: null });
  expect((await cancel()).status).toBe(200);
  expect(rpc).toHaveBeenCalledTimes(2); expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
});

// bl33 #2: a table order on a card page Stripe had already expired answered
// `changed`, which the wrapper never verifies, so the cancel was refused for ever.
describe("an expired card page does not block cancelling a table order", () => {
  const tableOrder = async (run: () => Promise<void>): Promise<void> => {
    const account = snapshot.order.account_id;
    (snapshot.order as { account_id: string | null }).account_id = null;
    try { await run(); } finally { snapshot.order.account_id = account; }
  };
  it("verifies the page and retries when the database answers paying", () => tableOrder(async () => {
    resolve.mockResolvedValue("closed");
    rpc.mockResolvedValueOnce({ data: { outcome: "paying" }, error: null })
      .mockResolvedValueOnce({ data: { outcome: "cancelled", adjustment: "a1" }, error: null });
    expect((await cancel()).status).toBe(200);
    expect(resolve).toHaveBeenCalledWith("r1", expect.objectContaining({ orderIds: ["o1"] }));
    expect(rpc).toHaveBeenCalledTimes(2);
  }));
  it("keeps refusing while the page is genuinely open", () => tableOrder(async () => {
    resolve.mockResolvedValue("open");
    rpc.mockResolvedValue({ data: { outcome: "paying" }, error: null });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("apiErr.accountBillPaying");
    expect(rpc).toHaveBeenCalledTimes(1);
  }));
  it("answers paying from SQL under the order lock, before the legacy writer reads it as changed", async () => {
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const start = schema.indexOf("create or replace function public.prepare_order_refund_v2(");
    expect(start).toBeGreaterThan(-1);
    const body = schema.slice(start, schema.indexOf("$$;", start));
    const lock = body.indexOf("for update;\n  if o.id is not null and not o.paid");
    expect(lock).toBeGreaterThan(-1);
    expect(body.indexOf("whole_bill_card_open_v1(p_restaurant, array[o.id])")).toBeGreaterThan(lock);
    expect(body.indexOf("'outcome', 'paying'")).toBeGreaterThan(lock);
    expect(body).toContain("return public.prepare_order_refund(p_restaurant, p_order, p_actor, p_legacy_demand,");
  });
});
