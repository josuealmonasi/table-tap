import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { returnFixture } from "@/lib/__tests__/returns-contract-fixtures";
const { rpc, syncFee, after, from } = vi.hoisted(() => ({ rpc: vi.fn(), syncFee: vi.fn(), after: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("../fee", () => ({ syncReturnedFee: syncFee }));
const { executeOrderRefund, orderRefunds, recoverOrderRefundFeesLater } = await import("../operations");
let fixture: ReturnType<typeof returnFixture>;
const attempt = { id: "attempt-1", operation_status: "pending", attempt_no: 1,
  amount: 33.34, outstanding_cents: 3334, created_at: new Date().toISOString(), currency: "MXN", stripe_account_id: "acct_original", stripe_payment_intent: "pi_original", idempotency_key: "cancel-original" };
function provider(made: unknown[] = []) {
  const evidence = { amount: 3334, currency: "mxn", payment_intent: "pi_original" };
  return {
    refunds: {
      list: vi.fn((_params?: Stripe.RefundListParams, _options?: Stripe.RequestOptions) => (async function* () {
        for (const r of made) yield { ...evidence, ...r as object };
      })()),
      create: vi.fn().mockResolvedValue({ ...evidence, id: "re_one", status: "succeeded" }),
      retrieve: vi.fn(),
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture = returnFixture();
  fixture.tables.refund_operations = [{ id: "operation", restaurant_id: "tenant", source: "stripe", status: "pending",
    currency: "MXN", stripe_account_id: "acct_original", stripe_payment_intent: "pi_original" }];
  fixture.tables.refund_attempts = [{ ...attempt, operation_id: "operation", restaurant_id: "tenant", origin: "app" }];
  from.mockImplementation(fixture.from);
  rpc.mockImplementation(async (name: string) => ({ data: name === "start_refund_attempt" ? attempt : { outcome: "completed" }, error: null }));
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
    expect(rpc).toHaveBeenLastCalledWith("finish_refund_operation_v2", expect.objectContaining({
      p_restaurant: "tenant", p_operation: "operation", p_refunds: [expect.objectContaining({ id: "re_one" })], p_attempt: "attempt-1", p_status: "succeeded",
    }));
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(syncFee.mock.invocationCallOrder[0]);
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
    expect(rpc).toHaveBeenLastCalledWith("finish_refund_operation_v2", expect.objectContaining({ p_refunds: [expect.objectContaining({ id: "re_prior" })] }));
  });
  it.each(["pending", "requires_action", "failed", "canceled"])("does not claim a %s refund completed", async status => {
    const client = provider(); client.refunds.create.mockResolvedValue({ id: "re_one", status, amount: 3334, currency: "mxn", payment_intent: "pi_original" });
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(false);
    expect(syncFee).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith("finish_refund_operation_v2", expect.objectContaining({ p_status: status }));
  });
  it("recovers fee reconciliation after restart without rebooking a completed return", async () => {
    fixture.tables.refund_operations[0].status = "succeeded";
    rpc.mockResolvedValue({ data: { ...attempt, operation_status: "succeeded" }, error: null });
    const client = provider();
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(syncFee).toHaveBeenCalledWith(client, "tenant", "pi_original", "acct_original");
    expect(client.refunds.create).not.toHaveBeenCalled();
  });
  it("recovers pending fees after responding, so Bills never waits for the provider", async () => {
    from.mockImplementation(() => {
      let recovery = false;
      const q = { select: () => q, eq: () => q, neq: () => q, order: () => q,
        is: () => { recovery = true; return q; },
        maybeSingle: async () => ({ data: { ...attempt, id: "operation", source: "stripe", status: "succeeded" }, error: null }),
        range: async (start: number) => ({ data: recovery && start === 0 ? [{ id: "operation" }] : [], error: null }) };
      return q;
    });
    rpc.mockResolvedValue({ data: { ...attempt, operation_status: "succeeded" }, error: null });
    expect(await orderRefunds("tenant")).toEqual([]);
    // The list Pedidos polls every 15 s schedules no write path; Bills does.
    expect(after).not.toHaveBeenCalled();
    recoverOrderRefundFeesLater("tenant");
    expect(syncFee).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(expect.any(Function));
    await after.mock.calls[0][0]();
    expect(syncFee).toHaveBeenCalledOnce();
  });
  it("cannot refund another tenant's operation", async () => {
    rpc.mockResolvedValue({ data: null, error: null }); const client = provider();
    expect(await executeOrderRefund("other", "operation", "manager", client as unknown as Stripe)).toBe(false);
    expect(client.refunds.list).not.toHaveBeenCalled(); expect(client.refunds.create).not.toHaveBeenCalled();
  });
  it("records customer success before a failed fee reconciliation", async () => {
    syncFee.mockRejectedValue(new Error("database unavailable")); const client = provider();
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("finish_refund_operation_v2", expect.objectContaining({ p_status: "succeeded", p_refunds: [expect.objectContaining({ id: "re_one" })] }));
  });
});

describe("the final Stripe refund listing", () => {
  it("posts after the same refund IDs are listed again", async () => {
    const client = provider([{ id: "re_old", status: "canceled" }]);
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(true);
    expect(client.refunds.list).toHaveBeenCalledTimes(2);
    expect(client.refunds.list).toHaveBeenLastCalledWith({ payment_intent: "pi_original", limit: 100 }, { stripeAccount: "acct_original" });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(client.refunds.list.mock.invocationCallOrder[1]);
    expect(client.refunds.list.mock.invocationCallOrder[1]).toBeLessThan(client.refunds.create.mock.invocationCallOrder[0]);
    expect(client.refunds.create).toHaveBeenCalledOnce();
  });

  it("records manual review when a foreign refund appears after the attempt opens", async () => {
    const write = Promise.resolve({ error: null });
    const filters = Object.assign(write, { eq: vi.fn(() => filters), is: vi.fn(() => filters) });
    const update = vi.fn((_table: string, _values: unknown) => filters);
    from.mockImplementation(table => ({ ...fixture.from(table), update: (values: unknown) => update(table, values) }));
    const client = provider();
    client.refunds.list.mockImplementationOnce(provider().refunds.list)
      .mockImplementationOnce(provider([{ id: "re_manual", amount: 1000, status: "succeeded" }]).refunds.list);

    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(false);
    expect(client.refunds.list).toHaveBeenCalledTimes(2);
    expect(client.refunds.create).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("start_refund_attempt", { p_restaurant: "tenant", p_operation: "operation" });
    expect(update).toHaveBeenCalledWith("refund_operations", { status: "review" });
    expect(update).toHaveBeenCalledWith("refund_attempts", { last_error: expect.stringMatching(/re_manual.*manager/) });
    expect(filters.eq).toHaveBeenCalledWith("restaurant_id", "tenant");
    expect(filters.eq).toHaveBeenCalledWith("status", "processing");
    expect(filters.eq).toHaveBeenCalledWith("id", "attempt-1");
    expect(console.error).toHaveBeenCalledWith("Order refund needs manual reconciliation", "operation", "attempt-1", "re_manual");
    expect(syncFee).not.toHaveBeenCalled();
  });

  it("throws on a lost page of the final listing without posting", async () => {
    const client = provider();
    client.refunds.list.mockImplementationOnce(provider().refunds.list).mockImplementationOnce(async function* () {
      yield* provider([{ id: "re_old", status: "canceled" }]).refunds.list();
      throw new Error("lost listing reply");
    });
    await expect(executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).rejects.toThrow("lost listing reply");
    expect(client.refunds.create).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(syncFee).not.toHaveBeenCalled();
  });

  it("recovers the same app attempt when its refund first appears in the final listing", async () => {
    const client = provider();
    client.refunds.list.mockImplementationOnce(provider().refunds.list)
      .mockImplementationOnce(provider([{ id: "re_ours", status: "succeeded", metadata: { refund_attempt: attempt.id } }]).refunds.list);
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(true);
    expect(client.refunds.create).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith("finish_refund_operation_v2", expect.objectContaining({
      p_refunds: [expect.objectContaining({ id: "re_ours" })],
    }));
  });

  it.each([false, true])("a review check only retires an expired attempt with no Stripe refund (provider refund: %s)", async hasRefund => {
    fixture.tables.refund_operations[0].status = "review";
    fixture.tables.refund_attempts[0].created_at = "2020-01-01T00:00:00Z";
    from.mockImplementation(table => {
      const q = fixture.from(table);
      return Object.assign(q, { limit: () => q });
    });
    const client = provider(hasRefund ? [{ id: "re_ours", status: "succeeded", metadata: { refund_attempt: attempt.id } }] : []);
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(false);
    expect(client.refunds.list).toHaveBeenCalledOnce();
    expect(client.refunds.create).not.toHaveBeenCalled();
    if (hasRefund) expect(rpc).not.toHaveBeenCalled();
    else expect(rpc).toHaveBeenCalledExactlyOnceWith("retire_unsent_refund_attempt_v1", {
      p_restaurant: "tenant", p_operation: "operation", p_attempt: attempt.id, p_actor: "manager",
    });
  });
});
