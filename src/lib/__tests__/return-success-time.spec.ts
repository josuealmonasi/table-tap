import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { fakeStripe } from "./refund-due-fixtures";
import { REF, returnFixture } from "./returns-contract-fixtures";

const { rpc, from, syncFee } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), syncFee: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/refunds/fee", () => ({ syncReturnedFee: syncFee }));
import { discoverReturn } from "@/lib/refunds/return-provider";
import { executeOrderRefund } from "@/lib/refunds/operations";

const operation = { id: "return-one", restaurant_id: "r1", source: "stripe", status: "pending",
  currency: "MXN", stripe_account_id: "acct_1", stripe_payment_intent: "pi_1" };
const created = 1793059200;
function providerRefund(over: Partial<Stripe.Refund>): Stripe.Refund {
  return { id: "re_manual", object: "refund", amount: 4000, currency: "mxn", payment_intent: "pi_1", created,
    status: "succeeded", metadata: {}, balance_transaction: null, charge: "ch_1", reason: null,
    receipt_number: null, source_transfer_reversal: null, transfer_reversal: null, ...over };
}
let fixture: ReturnType<typeof returnFixture>;
beforeEach(() => {
  vi.clearAllMocks();
  fixture = returnFixture();
  fixture.tables.refund_operations = [operation];
  from.mockImplementation(fixture.from);
  syncFee.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("return evidence dates", () => {
  it.each(["succeeded", "pending"] as const)("dates only succeeded manual evidence (%s)", async status => {
    fixture.tables.refund_attempts = [{ ...operation, id: "manual-evidence", operation_id: operation.id,
      origin: "manual", attribution_ref: REF, stripe_refund_id: "re_manual", amount: 40 }];
    rpc.mockResolvedValue({ data: { outcome: "partial", outstanding_cents: 6000 }, error: null });
    const made = [providerRefund({ status, metadata: { refund_operation: operation.id, return_attribution: REF } })];
    const { client } = fakeStripe({ currency: "mxn", made });

    await discoverReturn(client, "r1", operation, "manager");

    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_order_return_coverage_v1", expect.objectContaining({
      p_operation: operation.id, p_attribution_ref: REF,
      p_refunds: [expect.objectContaining({ id: "re_manual", amount_cents: 4000, status })],
    }));
    const evidence = rpc.mock.calls[0][1].p_refunds[0];
    if (status === "succeeded") expect(evidence).toHaveProperty("succeeded_at", created);
    else expect(evidence).not.toHaveProperty("succeeded_at");
  });

  it.each([false, true])("leaves app evidence dated by verification (recovered: %s)", async recovered => {
    const attempt = { id: "app-attempt", restaurant_id: "r1", operation_id: operation.id, origin: "app", attempt_no: 1,
      amount: 100, outstanding_cents: 10000, currency: "MXN", stripe_account_id: "acct_1",
      stripe_payment_intent: "pi_1", idempotency_key: "return-one-1", created_at: new Date().toISOString(),
      stripe_refund_id: recovered ? "re_app" : null };
    fixture.tables.refund_attempts = [attempt];
    rpc.mockImplementation(async name => ({ data: name === "start_refund_attempt" ? attempt
      : { outcome: "completed", outstanding_cents: 0 }, error: null }));
    const refund = providerRefund({ id: "re_app", amount: 10000, metadata: { refund_attempt: attempt.id } });
    const { client, calls } = fakeStripe({ currency: "mxn", made: recovered ? [refund] : [],
      create: async () => refund, retrieve: async () => refund });

    expect(await executeOrderRefund("r1", operation.id, "manager", client)).toBe(true);

    const finish = rpc.mock.calls.find(([name]) => name === "finish_refund_operation_v2");
    expect(finish?.[1].p_refunds).toEqual([expect.objectContaining({ id: "re_app", status: "succeeded" })]);
    expect(finish?.[1].p_refunds[0]).not.toHaveProperty("succeeded_at");
    expect(calls.create).toHaveBeenCalledTimes(recovered ? 0 : 1);
    expect(calls.retrieve).toHaveBeenCalledTimes(recovered ? 1 : 0);
  });
});
