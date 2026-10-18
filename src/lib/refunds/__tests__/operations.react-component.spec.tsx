import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const { rpc, syncFee } = vi.hoisted(() => ({ rpc: vi.fn(), syncFee: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("../fee", () => ({ syncReturnedFee: syncFee }));
const { executeOrderRefund } = await import("../operations");
const attempt = { id: "attempt-1", operation_status: "pending", attempt_no: 1,
  amount: 33.34, stripe_account_id: "acct_original", stripe_payment_intent: "pi_original", idempotency_key: "cancel-original" };
function provider(made: unknown[] = []) {
  return {
    refunds: {
      list: vi.fn(() => (async function* () { for (const r of made) yield r; })()),
      create: vi.fn().mockResolvedValue({ id: "re_one", status: "succeeded" }),
      retrieve: vi.fn(),
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (name: string) => ({ data: name === "start_refund_attempt" ? attempt : true, error: null }));
  syncFee.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
describe("durable order returns", () => {
  it("uses the original charge, account, exact cents and durable key", async () => {
    const client = provider();
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(true);
    expect(client.refunds.create).toHaveBeenCalledWith({ payment_intent: "pi_original", amount: 3334,
      refund_application_fee: true, metadata: { refund_operation: "operation", refund_attempt: "attempt-1" } },
    { stripeAccount: "acct_original", idempotencyKey: "cancel-original" });
    expect(rpc).toHaveBeenLastCalledWith("finish_refund_operation", expect.objectContaining({
      p_restaurant: "tenant", p_operation: "operation", p_refund: "re_one", p_attempt: "attempt-1", p_status: "succeeded",
    }));
    expect(syncFee.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[1]);
  });
  it("keeps an unknown provider outcome outstanding and retries the same request", async () => {
    const client = provider();
    client.refunds.create.mockRejectedValueOnce(new Error("lost response"));
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(true);
    expect(client.refunds.create.mock.calls[0]).toEqual(client.refunds.create.mock.calls[1]);
  });
  it("recovers a prior refund after provider idempotency expires", async () => {
    const client = provider([{ id: "re_prior", status: "succeeded", metadata: { refund_attempt: "attempt-1" } }]);
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(true);
    expect(client.refunds.create).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith("finish_refund_operation", expect.objectContaining({ p_refund: "re_prior" }));
  });
  it.each(["pending", "requires_action", "failed", "canceled"])("does not claim a %s refund completed", async status => {
    const client = provider(); client.refunds.create.mockResolvedValue({ id: "re_one", status });
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(false);
    expect(syncFee).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith("finish_refund_operation", expect.objectContaining({ p_status: status }));
  });
  it("cannot refund another tenant's operation", async () => {
    rpc.mockResolvedValue({ data: null, error: null }); const client = provider();
    expect(await executeOrderRefund("other", "operation", "manager", client as unknown as Stripe)).toBe(false);
    expect(client.refunds.list).not.toHaveBeenCalled(); expect(client.refunds.create).not.toHaveBeenCalled();
  });
  it("keeps completion recoverable when verified fee reconciliation fails", async () => {
    syncFee.mockRejectedValue(new Error("database unavailable")); const client = provider();
    await expect(executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).rejects.toThrow("database unavailable");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
