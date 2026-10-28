import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { due, fakeDb, fakeLedger, fakeStripe, stripeError } from "./refund-due-fixtures";
import { refundDue } from "@/lib/refund-due";

vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/activity-log", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/refunds/due-recovery", () => ({
  reconcileDueFee: vi.fn(async () => true),
  verifyDueCurrency: vi.fn(async () => "USD"),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function scenario(currency: string, manualCents = 4000, pendingCents = 0) {
  const rows = [due({ amount: 100, currency: currency.toUpperCase(), stripe_account_id: "acct_1" })];
  const db = fakeDb(rows);
  const rpc = vi.spyOn(db, "rpc");
  const made = [{ id: "re_manual", amount: manualCents, status: "succeeded", currency, metadata: {} },
    ...(pendingCents ? [{ id: "re_pending", amount: pendingCents, status: "pending", currency, metadata: {} }] : [])] as Stripe.Refund[];
  const { client, calls } = fakeStripe({ currency, made });
  let remaining = 10000 - manualCents - pendingCents;
  const create = calls.create.getMockImplementation()!;
  calls.create.mockImplementation(async params => {
    if (Number(params.amount) > remaining) {
      throw stripeError(remaining === 0 ? "charge_already_refunded" : "amount_too_large");
    }
    remaining -= Number(params.amount);
    return create(params);
  });
  calls.intent.mockImplementation(async () => ({ currency, latest_charge: {
    amount: 10000, amount_refunded: 10000 - remaining, application_fee: "fee_1",
  } }));
  const run = () => refundDue(db, "r1", "d1", "manager", client);
  return { rows, db, rpc, client, calls, run, ledger: fakeLedger(rows) };
}

describe.each(["mxn", "usd"])("manual duplicate-charge coverage in %s", currency => {
  it("sends only the remaining 60 with a new immutable attempt", async () => {
    const { run, calls, ledger } = scenario(currency);
    expect(await run()).toMatchObject({ ok: true });
    // The manual part is recorded before any attempt opens, so the first one
    // is already the capped remainder (contract with Codex, dialogue refund7).
    expect(calls.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ amount: 6000 }),
      expect.objectContaining({ idempotencyKey: "refund-due-d1", stripeAccount: "acct_1" }));
    expect(ledger.attempts.get("d1")).toMatchObject({ attempt_no: 1, amount: 60 });
    expect([...ledger.coverage.get("d1")!.entries()]).toEqual([
      ["re_manual", { amount_cents: 4000, active: true }],
      ["re_1", { amount_cents: 6000, active: true }],
    ]);
  });

  it("counts the manual part once after retrying a successful remainder", async () => {
    const { run, calls, ledger } = scenario(currency);
    await run();
    await run();
    expect(calls.create).toHaveBeenCalledTimes(1);
    expect(ledger.coverage.get("d1")?.size).toBe(2);
    expect([...ledger.coverage.get("d1")!.values()].reduce((sum, r) => sum + r.amount_cents, 0)).toBe(10000);
  });

  it("finishes a full manual refund without posting another refund", async () => {
    const { run, calls, rows, ledger } = scenario(currency, 10000);
    expect(await run()).toMatchObject({ ok: true, alreadyInStripe: true });
    expect(calls.create).not.toHaveBeenCalled();
    expect(rows[0].refunded_at).toEqual(expect.any(String));
    expect(ledger.coverage.get("d1")?.get("re_manual")).toEqual({ amount_cents: 10000, active: true });
  });

  it("freezes a smaller provider ceiling instead of editing a 60 attempt to 50", async () => {
    const { run, calls, ledger, rows } = scenario(currency, 4000, 1000);
    await run();
    expect(calls.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ amount: 5000 }),
      expect.objectContaining({ stripeAccount: "acct_1" }));
    expect(ledger.attempts.get("d1")).toMatchObject({ amount: 50 });
    expect(ledger.coverage.get("d1")?.has("re_pending")).toBe(false);
    expect(rows[0].refunded_at).toBeNull();
  });
});

it("the current finish cannot record manual coverage without resolving an unknown outbound attempt", async () => {
  const { db, ledger } = scenario("mxn");
  const { data: attempt } = await db.rpc("start_refund_due_attempt", { p_restaurant: "r1", p_due: "d1" });
  // An unknown POST is still the same request. A different refund succeeding
  // must not be treated as proof that this request has finished.
  expect(ledger.attempts.get("d1")?.provider_status).toBeUndefined();
  const { data: recorded } = await db.rpc("finish_refund_due_attempt_v2", {
    p_restaurant: "r1", p_due: "d1", p_attempt: attempt.id, p_actor: "manager",
    p_refunds: [{ id: "re_manual", amount_cents: 4000 }], p_status: "succeeded",
  });
  expect(recorded).toMatchObject({ outcome: "partial", outstanding_cents: 6000 });
  expect(ledger.attempts.get("d1")?.provider_status).toBe("succeeded");
  const { data: next } = await db.rpc("start_refund_due_attempt", { p_restaurant: "r1", p_due: "d1" });
  expect(next).toMatchObject({ attempt_no: 2, amount: 60 });
});
