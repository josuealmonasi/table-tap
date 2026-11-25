import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { due, fakeDb, fakeLedger, fakeStripe } from "./refund-due-fixtures";
import { refundDue } from "@/lib/refund-due";

vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/activity-log", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/refunds/due-recovery", () => ({
  reconcileDueFee: vi.fn(async () => true), verifyDueCurrency: vi.fn(async () => "MXN"),
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

it.each(["unknown", "pending", "succeeded"] as const)("resumes its own %s attempt after manual coverage answers partial", async status => {
  const rows = [due({ amount: 100, currency: "MXN", stripe_account_id: "acct_1" })];
  const db = fakeDb(rows);
  await db.rpc("start_refund_due_attempt_v2", { p_restaurant: "r1", p_due: "d1", p_refundable_cents: 20000 });
  const ledger = fakeLedger(rows);
  const attempt = ledger.attempts.get("d1")!;
  if (status !== "unknown") Object.assign(attempt, { provider_status: "pending", stripe_refund_id: "re_app" });
  const saved = { ...attempt };
  const originalRpc = db.rpc.bind(db);
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    // SQL refuses new manual coverage while this request is unresolved.
    // Its partial answer must still let TypeScript resume that exact request.
    if (name === "record_refund_due_coverage_v1") return { data: { outcome: "partial", outstanding_cents: 10000 }, error: null };
    return originalRpc(name, args);
  });
  const resumeDb = { ...db, rpc } as unknown as typeof db;
  const appRefund = { id: "re_app", amount: 10000, currency: "mxn", status: status === "pending" ? "pending" : "succeeded" };
  const made = [{ id: "re_manual", amount: 4000, currency: "mxn", status: "succeeded", metadata: {} }] as Stripe.Refund[];
  const { client, calls } = fakeStripe({ currency: "mxn", made, create: async () => appRefund, retrieve: async () => appRefund });

  const answer = await refundDue(resumeDb, "r1", "d1", "manager", client);

  if (status === "unknown") {
    // Never sent, and decided before anyone recorded the charge: the MX$40
    // made by hand since then is counted and only the MX$60 left is sent
    // (bl43 finding 1). Sending the frozen MX$100 returned MX$140.
    expect(answer).toMatchObject({ ok: true });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "record_refund_due_coverage_v1", "start_refund_due_attempt_v3", "reconcile_refund_due_send_v1", "finish_refund_due_attempt_v2",
    ]);
    expect(ledger.attempts.get("d1")).toMatchObject({ attempt_no: 2, amount: 60, idempotency_key: "refund-due-d1-2" });
    expect(ledger.coverage.get("d1")?.get("re_manual")).toEqual({ amount_cents: 4000, active: true });
    expect(calls.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ amount: 6000 }),
      expect.objectContaining({ idempotencyKey: "refund-due-d1-2", stripeAccount: "acct_1" }));
    return;
  }
  expect(answer).toMatchObject(status === "pending" ? { ok: false, error: "apiErr.refundPending" } : { ok: true, amount: 100 });
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "record_refund_due_coverage_v1", "start_refund_due_attempt_v3", "finish_refund_due_attempt_v2",
  ]);
  expect(ledger.attempts.get("d1")).toMatchObject({ id: saved.id, amount: saved.amount, idempotency_key: saved.idempotency_key, attempt_no: 1 });
  expect(ledger.coverage.get("d1")?.has("re_manual")).toBe(false);
  expect(calls.create).not.toHaveBeenCalled();
  expect(calls.retrieve).toHaveBeenCalledWith("re_app", { stripeAccount: "acct_1" });
});
