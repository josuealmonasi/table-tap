import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { fakeStripe, stripeError } from "./refund-due-fixtures";
import { returnFixture } from "./returns-contract-fixtures";

const { rpc, syncFee, from } = vi.hoisted(() => ({ rpc: vi.fn(), syncFee: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/refunds/fee", () => ({ syncReturnedFee: syncFee }));
import { executeOrderRefund } from "@/lib/refunds/operations";

const attempt = (operation: string, amount = 100) => ({ id: `${operation}-attempt-1`, operation_id: operation,
  operation_status: "pending", attempt_no: 1, amount, currency: "MXN", stripe_account_id: "acct_1",
  stripe_payment_intent: "pi_1", idempotency_key: `return-${operation}-1` });
let fixture: ReturnType<typeof returnFixture>;
beforeEach(() => {
  vi.clearAllMocks(); syncFee.mockResolvedValue(undefined);
  fixture = returnFixture();
  fixture.tables.refund_operations = ["return-one", "return-two"].map(id => ({ id, restaurant_id: "r1", source: "stripe",
    status: "pending", amount: 100, tip: 0, currency: "MXN", stripe_account_id: "acct_1", stripe_payment_intent: "pi_1" }));
  from.mockImplementation(fixture.from);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("card returns keep operation identity and actual customer coverage", () => {
  it("gives two sequential returns on one charge their own first-attempt key", async () => {
    fixture.tables.refund_operations.forEach(row => { row.amount = 30; });
    rpc.mockImplementation(async (name, args) => ({ data: name === "start_refund_attempt" ? attempt(args.p_operation, 30)
      : name === "finish_refund_operation_v2" ? { outcome: "completed", outstanding_cents: 0 } : true, error: null }));
    let serial = 0;
    const { client, calls } = fakeStripe({ currency: "mxn", create: async () => ({ id: `re_${++serial}`, status: "succeeded", currency: "mxn", payment_intent: "pi_1" }) });
    expect(await executeOrderRefund("r1", "return-one", "manager", client)).toBe(true);
    expect(await executeOrderRefund("r1", "return-two", "manager", client)).toBe(true);
    expect(calls.create.mock.calls.map(call => call[0].amount)).toEqual([3000, 3000]);
    expect(calls.create.mock.calls.map(call => (call as unknown as [unknown, Stripe.RequestOptions])[1].idempotencyKey))
      .toEqual(["return-return-one-1", "return-return-two-1"]);
    // The executor already obeys saved keys. SQL must stop creating the same
    // order/charge key for every first attempt; these mocks cannot prove that.
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const start = schema.split("create or replace function public.start_refund_attempt(")[1].split("$$;")[0];
    expect(start).not.toMatch(/when v_no = 1 then 'cancel-'/);
    expect(start).toContain("'return-' || o.id || '-' || v_no");
  });

  it("does not POST a full refund over an unassigned manual partial refund", async () => {
    rpc.mockImplementation(async name => ({ data: name === "start_refund_attempt" ? attempt("return-one") : false, error: null }));
    const made = [{ id: "re_manual", amount: 4000, currency: "mxn", payment_intent: "pi_1", status: "succeeded", metadata: {} }] as Stripe.Refund[];
    const { client, calls } = fakeStripe({ currency: "mxn", made, create: async () => { throw stripeError("amount_too_large"); } });
    expect(await executeOrderRefund("r1", "return-one", "manager", client)).toBe(false);
    expect(calls.create).not.toHaveBeenCalled();
    expect(syncFee).not.toHaveBeenCalled();
  });

  it("adopts an explicitly attributed manual 40 and sends only the outstanding 60", async () => {
    let covered = 0;
    fixture.tables.refund_attempts = [{ id: "manual-evidence", restaurant_id: "r1", operation_id: "return-one", origin: "manual",
      attribution_ref: "22222222-2222-4222-8222-222222222222", stripe_refund_id: "re_manual", amount: 40, currency: "MXN",
      stripe_payment_intent: "pi_1", stripe_account_id: "acct_1", provider_status: "succeeded" }];
    rpc.mockImplementation(async (name, args) => {
      if (name === "record_order_return_coverage_v1") {
        covered = 4000;
        return { data: { outcome: "partial", outstanding_cents: 6000 }, error: null };
      }
      if (name === "start_refund_attempt") return { data: attempt("return-one", (10000 - covered) / 100), error: null };
      if (name === "finish_refund_operation_v2") return { data: { outcome: "completed", outstanding_cents: 0 }, error: null };
      // This is the old finisher's bug: a succeeded 40 is accepted as all 100.
      return { data: args.p_status === "succeeded", error: null };
    });
    const made = [{ id: "re_manual", amount: 4000, currency: "mxn", payment_intent: "pi_1", status: "succeeded",
      metadata: { refund_operation: "return-one", return_attribution: "22222222-2222-4222-8222-222222222222" } }] as unknown as Stripe.Refund[];
    const { client, calls } = fakeStripe({ currency: "mxn", made, create: async () => ({ id: "re_remainder", status: "succeeded", currency: "mxn", payment_intent: "pi_1" }) });
    expect(await executeOrderRefund("r1", "return-one", "manager", client)).toBe(true);
    expect(calls.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ amount: 6000 }),
      expect.objectContaining({ stripeAccount: "acct_1", idempotencyKey: "return-return-one-1" }));
    expect(rpc).toHaveBeenCalledWith("record_order_return_coverage_v1", expect.objectContaining({
      p_operation: "return-one", p_attribution_ref: "22222222-2222-4222-8222-222222222222",
      p_refunds: expect.arrayContaining([expect.objectContaining({ id: "re_manual", amount_cents: 4000 })]),
    }));
    expect(rpc).toHaveBeenCalledWith("finish_refund_operation_v2", expect.objectContaining({
      p_operation: "return-one", p_refunds: expect.arrayContaining([expect.objectContaining({ amount_cents: 6000 })]),
    }));
    const callsInOrder = rpc.mock.calls.map(([name]) => name);
    expect(callsInOrder.indexOf("record_order_return_coverage_v1")).toBeLessThan(callsInOrder.indexOf("start_refund_attempt"));
  });
});
