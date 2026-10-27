import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { syncReturnedFee } from "@/lib/refunds/fee";

const logged: { action: string; detail?: string | null }[] = [];
vi.mock("@/lib/activity-log", () => ({
  logEvent: async (e: { action: string; detail?: string | null }) => void logged.push(e),
}));
vi.mock("@/lib/refunds/fee", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/refunds/fee")>();
  return { syncReturnedFee: vi.fn(actual.syncReturnedFee) };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: feeVerification }) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));

import { corteFrom } from "@/lib/corte";
import { refundDue, refundDueLogDetail } from "@/lib/refund-due";

import { due, fakeDb, fakeStripe, feeVerification, stripeError } from "./refund-due-fixtures";

beforeEach(() => {
  logged.length = 0;
  vi.clearAllMocks();
});

describe("refunding a payment taken twice", () => {
  it("refunds the amount taken twice from the restaurant's account, with our fee", async () => {
    const rows = [due()];
    const { client, calls } = fakeStripe();
    const answer = await refundDue(fakeDb(rows), "r1", "d1", "ana@x.dev", client);
    expect(answer).toEqual({ ok: true, amount: 125.5, alreadyInStripe: false });
    expect(calls.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 12550, refund_application_fee: true, metadata: { refund_due: "d1", refund_due_attempt: "due-attempt-1" } },
      { idempotencyKey: "refund-due-d1", stripeAccount: "acct_1" },
    );
    expect(rows[0]).toMatchObject({ refunded_by: "ana@x.dev", stripe_refund_id: "re_1" });
    expect(rows[0].refunded_at).toBeTruthy();
    expect(logged).toHaveLength(1);
  });

  it("audit Q 2: a stale success the database refused, because Stripe since failed it, is never reported as refunded", async () => {
    const rows = [due()];
    const db = fakeDb(rows) as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<unknown> };
    const rpc = db.rpc.bind(db);
    // finish_refund_due_attempt records the known failure and returns false.
    db.rpc = async (name, args) => name === "finish_refund_due_attempt" ? { data: false, error: null } : rpc(name, args);
    const { client } = fakeStripe();
    expect(await refundDue(db as never, "r1", "d1", "manager", client)).toMatchObject({ ok: false, error: "apiErr.refundPending", status: 409 });
    expect(rows[0].refunded_at).toBeNull();
    expect(logged).toHaveLength(0);
  });

  it("keeps a pending provider refund owed instead of claiming it completed", async () => {
    const rows = [due()];
    const { client } = fakeStripe({ create: async () => ({ id: "re_pending", status: "pending" }) });
    expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toMatchObject({ ok: false, error: "apiErr.refundPending", status: 409 });
    expect(rows[0].refunded_at).toBeNull();
    expect(logged).toHaveLength(0);
  });

  it.each(["failed", "canceled"])("retries a confirmed %s duplicate refund with a fresh durable key", async status => {
    const rows = [due()]; const db = fakeDb(rows);
    const { client, calls } = fakeStripe();
    calls.create.mockResolvedValueOnce({ id: "re_failed", status } as never);
    expect(await refundDue(db, "r1", "d1", "manager", client)).toMatchObject({ ok: false });
    expect(await refundDue(db, "r1", "d1", "manager", client)).toMatchObject({ ok: true });
    expect(calls.create).toHaveBeenCalledTimes(2);
    expect(calls.create.mock.calls[0]).not.toEqual(calls.create.mock.calls[1]);
    expect(calls.create.mock.calls[1]).toEqual([expect.objectContaining({ metadata: {
      refund_due: "d1", refund_due_attempt: "due-attempt-2" } }), expect.objectContaining({ idempotencyKey: "refund-due-d1-2" })]);
  });

  it("records customer success before a failed fee lookup", async () => {
    vi.mocked(syncReturnedFee).mockRejectedValueOnce(new Error("fee unavailable"));
    const rows = [due()]; const { client } = fakeStripe();
    expect(await refundDue(fakeDb(rows), "r1", "d1", "manager", client)).toMatchObject({ ok: true });
    expect(rows[0]).toMatchObject({ stripe_refund_id: "re_1", refunded_at: expect.any(String) });
  });

  it("retries an outstanding fee after customer completion without another customer refund", async () => {
    vi.mocked(syncReturnedFee).mockRejectedValueOnce(new Error("fee unavailable"));
    const rows = [due()]; const db = fakeDb(rows); const { client, calls } = fakeStripe();
    expect(await refundDue(db, "r1", "d1", "manager", client)).toMatchObject({ ok: true, feePending: true });
    expect(rows[0].fee_reconciled_at).toBeUndefined();
    const completed = rows[0].refunded_at;
    expect(await refundDue(db, "r1", "d1", "manager", client)).toMatchObject({ ok: true });
    expect(rows[0].fee_reconciled_at).toEqual(expect.any(String));
    expect(syncReturnedFee).toHaveBeenCalledTimes(2);
    expect(calls.create).toHaveBeenCalledTimes(1);
    expect(rows[0].refunded_at).toBe(completed);
    expect(logged).toHaveLength(1);
  });

  it("reports the charge currency instead of relabelling the refund", async () => {
    const rows = [due()]; const { client } = fakeStripe();
    await refundDue(fakeDb(rows), "r1", "d1", "manager", client);
    expect(logged[0].detail).toContain("currency=USD");
  });

  it("preserves a pending attempt and retrieves it without creating another refund", async () => {
    const rows = [due()]; const db = fakeDb(rows);
    const { client, calls } = fakeStripe({ create: async () => ({ id: "re_wait", status: "pending" }),
      retrieve: async () => ({ id: "re_wait", status: "succeeded" }) });
    expect(await refundDue(db, "r1", "d1", "manager", client)).toMatchObject({ error: "apiErr.refundPending" });
    expect(await refundDue(db, "r1", "d1", "manager", client)).toMatchObject({ ok: true });
    expect(calls.create).toHaveBeenCalledTimes(1);
    expect(calls.retrieve).toHaveBeenCalledWith("re_wait", { stripeAccount: "acct_1" });
  });

  it("leaves the row owed when Stripe refuses, so it can be tried again", async () => {
    const rows = [due()];
    const { client } = fakeStripe({ create: async () => Promise.reject(stripeError("card_declined")) });
    const answer = await refundDue(fakeDb(rows), "r1", "d1", "ana@x.dev", client);
    expect(answer).toEqual({ ok: false, error: "apiErr.refundDueFailed", status: 502 });
    expect(rows[0].refunded_at).toBeNull();
    expect(logged).toHaveLength(0);
  });

  it("never refunds twice: a refund Stripe already made for this row is reused", async () => {
    // The server died after Stripe refunded and before the row was written.
    const rows = [due()];
    const { client, calls } = fakeStripe({
      made: [{ id: "re_old", status: "succeeded", metadata: { refund_due: "d1" } } as unknown as Stripe.Refund],
    });
    const answer = await refundDue(fakeDb(rows), "r1", "d1", "ana@x.dev", client);
    expect(answer.ok).toBe(true);
    expect(calls.create).not.toHaveBeenCalled();
    expect(rows[0].stripe_refund_id).toBe("re_old");
  });

  it("returns our fee when the diner was already refunded by hand in Stripe", async () => {
    const rows = [due({ amount: 251 })];
    const { client, calls } = fakeStripe({ create: async () => Promise.reject(stripeError("charge_already_refunded")),
      made: [{ id: "re_manual", amount: 25100, status: "succeeded", metadata: {} } as Stripe.Refund] });
    const answer = await refundDue(fakeDb(rows), "r1", "d1", "ana@x.dev", client);
    expect(answer).toEqual({ ok: true, amount: 251, alreadyInStripe: true });
    // The whole charge was taken twice, so the whole fee goes back.
    expect(calls.feeRefund).toHaveBeenCalledWith(
      "fee_1",
      { amount: 500, metadata: { refund_due: "d1" } },
      { idempotencyKey: "refund-due-fee-d1" },
    );
    expect(rows[0].refunded_at).toBeTruthy();
  });

  it("refuses one already refunded, another restaurant's, or one with no Stripe account", async () => {
    const { client, calls } = fakeStripe();
    expect(await refundDue(fakeDb([due({ refunded_at: "2026-10-03", fee_reconciled_at: "2026-10-03" })]), "r1", "d1", "a", client)).toMatchObject({ status: 409 });
    expect(await refundDue(fakeDb([due()]), "r2", "d1", "a", client)).toMatchObject({ status: 404 });
    expect(await refundDue(fakeDb([due()], null), "r1", "d1", "a", client)).toMatchObject({
      error: "apiErr.refundNeedsStripe",
    });
    expect(calls.create).not.toHaveBeenCalled();
  });

  it("answers the second of two clicks without a second refund", async () => {
    const rows = [due()];
    const { client } = fakeStripe({ create: async () => Promise.reject(stripeError("idempotency_key_in_use")) });
    expect(await refundDue(fakeDb(rows), "r1", "d1", "a", client)).toMatchObject({ error: "apiErr.alreadyRefunded" });
    expect(rows[0].refunded_at).toBeNull();
  });
});

describe("the corte and a refund due", () => {
  it("does not take a refund due out of the day's takings, which never counted it", () => {
    // A double payment is kept out of the ledger, so the corte never had it.
    const card = { actor_email: null, amount: 90, method: "card" };
    const corte = corteFrom([card], [{ action: "refunded", detail: refundDueLogDetail(90, "4") }]);
    expect(corte.online).toBe(90);
  });
});
