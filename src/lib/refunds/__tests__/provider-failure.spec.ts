import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// Audit O finding 1: Stripe failed a refund it first reported as succeeded,
// and nothing listened, so the diner's money stayed shown as returned.
const state = vi.hoisted(() => ({
  restaurant: { id: "r1" } as { id: string } | null,
  reopened: "operation" as string | null,
  rpcError: null as { message: string } | null,
  rpc: vi.fn(), log: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: state.restaurant, error: null }) };
    return q;
  },
  rpc: async (name: string, args: unknown) => { state.rpc(name, args); return { data: state.reopened, error: state.rpcError }; },
}) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: (e: unknown) => state.log(e) }));
const { reopenFailedRefund, REFUND_FAILURE_EVENTS } = await import("@/lib/refunds/provider-failure");

const refund = (extra: Partial<Stripe.Refund> = {}) =>
  ({ id: "re_1", status: "failed", amount: 10050, currency: "mxn", payment_intent: "pi_1", ...extra }) as Stripe.Refund;
beforeEach(() => {
  state.restaurant = { id: "r1" }; state.reopened = "operation"; state.rpcError = null;
  state.rpc.mockClear(); state.log.mockClear();
});

it("listens to every event a later failure arrives as", () => {
  expect([...REFUND_FAILURE_EVENTS].sort()).toEqual(["charge.refund.updated", "refund.failed", "refund.updated"]);
});
it.each([["mxn", "MXN"], ["usd", "USD"]])("reopens a failed %s refund on the account's own restaurant and tells the owner once", async (currency, code) => {
  await reopenFailedRefund(refund({ currency }), "acct_1");
  expect(state.rpc).toHaveBeenCalledWith("reverse_failed_refund", { p_restaurant: "r1", p_intent: "pi_1", p_refund: "re_1", p_status: "failed" });
  expect(state.log).toHaveBeenCalledTimes(1);
  expect(state.log.mock.calls[0][0]).toMatchObject({ restaurantId: "r1", entity: "order", action: "refund_failed" });
  expect(state.log.mock.calls[0][0].detail).toContain("100.50");
  expect(state.log.mock.calls[0][0].detail).toContain(code);
});
it("logs a reopened duplicate-charge refund against the bill", async () => {
  state.reopened = "due";
  await reopenFailedRefund(refund({ status: "canceled", payment_intent: { id: "pi_2" } as Stripe.PaymentIntent }), "acct_1");
  expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_intent: "pi_2", p_status: "canceled" });
  expect(state.log.mock.calls[0][0]).toMatchObject({ entity: "bill" });
});
it("logs nothing when the event repeats and nothing was reopened", async () => {
  state.reopened = null;
  await reopenFailedRefund(refund(), "acct_1");
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(state.log).not.toHaveBeenCalled();
});
it.each([
  ["a refund that succeeded", refund({ status: "succeeded" }), "acct_1"],
  ["a pending refund", refund({ status: "pending" }), "acct_1"],
  ["an event with no connected account", refund(), undefined],
  ["a refund with no charge", refund({ payment_intent: null }), "acct_1"],
])("ignores %s", async (_name, r, account) => {
  await reopenFailedRefund(r, account);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("ignores an account that is no restaurant here", async () => {
  state.restaurant = null;
  await reopenFailedRefund(refund(), "acct_other");
  expect(state.rpc).not.toHaveBeenCalled();
});
it("throws when the reversal fails, so Stripe sends the event again", async () => {
  state.rpcError = { message: "lock timeout" };
  await expect(reopenFailedRefund(refund(), "acct_1")).rejects.toThrow("lock timeout");
  expect(state.log).not.toHaveBeenCalled();
});

it("reverses under the money lock, scoped to the restaurant and charge, callable by the server only", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const body = sql.slice(sql.lastIndexOf("create or replace function public.reverse_failed_refund(")).split("$$;")[0];
  const lock = body.indexOf("lock_restaurant_money(p_restaurant)");
  expect(lock).toBeGreaterThan(0);
  expect(lock).toBeLessThan(body.indexOf("update "));
  for (const update of body.split("update ").slice(1)) expect(update).toMatch(/restaurant_id = p_restaurant|where (operation_id|due_id|id) = (o|d)\.id/);
  expect(body).toContain("stripe_payment_intent = p_intent");
  expect(body).toContain("p_status not in ('failed', 'canceled')");
  expect(sql).toContain("revoke all on function public.reverse_failed_refund(uuid, text, text, text) from public, anon, authenticated;");
  expect(sql).toContain("grant execute on function public.reverse_failed_refund(uuid, text, text, text) to service_role;");
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain("drop function if exists public.reverse_failed_refund(uuid, text, text, text);");
});
