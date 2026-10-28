import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { due, fakeDb, fakeStripe, fakeLedger, feeVerification } from "./refund-due-fixtures";
import { refundDue } from "@/lib/refund-due";
import { verifyDueCurrency } from "@/lib/refunds/due-recovery";

vi.mock("@/lib/activity-log", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: feeVerification }) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

it("persists a manual fee return failure after customer completion and retries the same request", async () => {
  vi.useFakeTimers();
  const rows = [due({ amount: 251, refunded_at: "2026-10-01", stripe_refund_id: "re_manual" })];
  const { client, calls } = fakeStripe({ made: [{ id: "re_manual", amount: 25100, status: "succeeded" } as Stripe.Refund] });
  calls.feeRefund.mockRejectedValueOnce(new Error("fee unavailable"));
  expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toMatchObject({ ok: true, feePending: true });
  const request = { ...fakeLedger(rows).returns[0] };
  expect(request).toMatchObject({ stripe_fee_id: "fee_1", amount_cents: 500, status: "dispatched" });
  expect(rows[0].fee_reconciled_at).toBeNull();
  // A new database client after restart sees the saved request and completion.
  // An unknown POST waits over an hour, then reuses its immutable row and key.
  expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toMatchObject({ feePending: true });
  expect(calls.feeRefund).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(3600001);
  expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toEqual({ ok: true, amount: 251, alreadyInStripe: true });
  expect(calls.feeRefund).toHaveBeenCalledTimes(2);
  expect(calls.feeRefund.mock.calls[0]).toEqual(calls.feeRefund.mock.calls[1]);
  expect(fakeLedger(rows).returns).toHaveLength(1);
  expect(fakeLedger(rows).returns[0]).toMatchObject({ ...request, status: "succeeded", claimed_at: Date.now() });
  expect(calls.create).not.toHaveBeenCalled();
  expect(rows[0].refunded_at).toBe("2026-10-01");
  expect(rows[0].fee_reconciled_at).toEqual(expect.any(String));
});

it("finds fee evidence after a lost response and an expired idempotency key", async () => {
  vi.useFakeTimers();
  const rows = [due({ amount: 251, refunded_at: "2026-10-01", stripe_refund_id: "re_manual" })];
  const { client, calls } = fakeStripe({ made: [{ id: "re_manual", amount: 25100, status: "succeeded" } as Stripe.Refund] });
  const create = calls.feeRefund.getMockImplementation()!;
  calls.feeRefund.mockImplementationOnce(async (...args) => { await create(...args); throw new Error("lost response"); });
  expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toMatchObject({ feePending: true });
  vi.advanceTimersByTime(24 * 3600000);
  expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toMatchObject({ ok: true });
  expect(calls.feeRefund).toHaveBeenCalledTimes(1);
  expect(fakeLedger(rows).returns).toHaveLength(1);
  expect(fakeLedger(rows).returns[0]).toMatchObject({ status: "succeeded", provider_fee_refund_id: "fr_1" });
  expect(calls.feeList).toHaveBeenCalledWith("fee_1", { limit: 100 });
  expect(rows[0].fee_reconciled_at).toEqual(expect.any(String));
});

it("keeps a partial fee pending when provider evidence already names this request", async () => {
  const rows = [due({ amount: 251, refunded_at: "2026-10-01", stripe_refund_id: "re_manual" })];
  const { client, calls } = fakeStripe({ made: [{ id: "re_manual", amount: 25100, status: "succeeded" } as Stripe.Refund] });
  calls.feeRefund.mockRejectedValueOnce(new Error("lost response"));
  expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toMatchObject({ feePending: true });
  const request = fakeLedger(rows).returns[0];
  calls.feeRefund.mockClear();
  calls.feeList.mockImplementation(() => ({ async *[Symbol.asyncIterator]() {
    yield { id: "fr_partial", amount: 180, currency: "usd", metadata: { fee_return: request.id } };
  } }));
  expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toMatchObject({ feePending: true });
  expect(calls.feeList).toHaveBeenCalledWith("fee_1", { limit: 100 });
  expect(calls.feeRefund).not.toHaveBeenCalled();
  expect(request.status).toBe("dispatched");
  expect(fakeLedger(rows).returns).toHaveLength(1);
  expect(rows[0].fee_reconciled_at).toBeNull();
});

it("keeps the frozen Stripe account when the restaurant reconnects", async () => {
  const rows = [due({ currency: "USD", stripe_account_id: "acct_original", refunded_at: "2026-10-01" })];
  const { client, calls } = fakeStripe({ made: [{ amount: 12550, status: "succeeded" } as Stripe.Refund] });
  await refundDue(fakeDb(rows, "acct_new"), "r1", "d1", "manager", client);
  expect(calls.intent).toHaveBeenCalledWith("pi_1", { expand: ["latest_charge"] }, { stripeAccount: "acct_original" });
  expect(calls.create).not.toHaveBeenCalled();
});

it("leaves older currency unverified when original provider evidence is unavailable", async () => {
  const rows = [due({ currency: null })];
  const { client, calls } = fakeStripe();
  calls.intent.mockRejectedValueOnce(new Error("unavailable"));
  expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toMatchObject({ ok: true });
  expect(rows[0].currency).toBeNull();
});

it("fills an older currency from Stripe without replacing an already verified value", async () => {
  const rows = [due({ currency: null })];
  const { client } = fakeStripe();
  const attempt = { id: "a", attempt_no: 1, idempotency_key: "k", amount: 125.5,
    stripe_account_id: "acct_original", stripe_payment_intent: "pi_1", stripe_refund_id: null };
  expect(await verifyDueCurrency(fakeDb(rows), "r1", "d1", attempt, client)).toBe("USD");
  expect(rows[0]).toMatchObject({ currency: "USD", stripe_account_id: "acct_original" });
  rows[0].currency = "MXN";
  await verifyDueCurrency(fakeDb(rows), "r1", "d1", attempt, client);
  expect(rows[0].currency).toBe("MXN");
});

it.each(["usd", "mxn"] as const)("never replaces an unknown %s fee send after the 23-hour window", async currency => {
  vi.useFakeTimers();
  const rows = [due({ currency: currency.toUpperCase(), amount: 251, refunded_at: "2026-10-01", stripe_refund_id: "re_manual" })];
  const { client, calls } = fakeStripe({ currency, made: [{ id: "re_manual", amount: 25100, status: "succeeded" } as Stripe.Refund] });
  calls.feeRefund.mockRejectedValueOnce(new Error("unknown outcome"));
  expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toMatchObject({ feePending: true });
  vi.advanceTimersByTime(24 * 3600000);
  for (let retry = 0; retry < 2; retry++) {
    expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toMatchObject({ feePending: true });
  }
  expect(calls.feeRefund).toHaveBeenCalledTimes(1);
  expect(calls.create).not.toHaveBeenCalled();
  expect(fakeLedger(rows).returns).toHaveLength(1);
  expect(fakeLedger(rows).returns[0]).toMatchObject({ status: "unresolved", currency: currency.toUpperCase(), amount_cents: 500 });
  expect(rows[0]).toMatchObject({ fee_reconciled_at: null, fee_verification_pending: true });
});
