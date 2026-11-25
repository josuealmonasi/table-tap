import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { due, fakeDb, fakeLedger, fakeStripe } from "./refund-due-fixtures";
import { refundDue } from "@/lib/refund-due";

// Codex bl43 finding 1: a MX$100 duplicate-payment due on a MX$200 charge.
// Between TableTap reading the charge and sending its refund, somebody
// returns MX$40 by hand in Stripe. Stripe still accepts MX$100, so the diner
// got MX$140 back. The charge is now read again right before every POST.
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/activity-log", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/refunds/due-recovery", () => ({
  reconcileDueFee: vi.fn(async () => true), verifyDueCurrency: vi.fn(async () => "MXN"),
}));
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

type Made = Pick<Stripe.Refund, "id" | "amount" | "status" | "metadata">;

/** A charge whose refunds change right after TableTap first reads it. */
function race(chargeCents: number, appears: Made[]) {
  const rows = [due({ amount: 100, currency: "MXN", stripe_account_id: "acct_1" })];
  const db = fakeDb(rows);
  const onCharge: Made[] = [];
  const original = db.rpc.bind(db);
  let landed = false;
  const rpc = vi.spyOn(db, "rpc").mockImplementation((async (name: string, args: Record<string, unknown>) => {
    const answer = await original(name as never, args as never);
    // The attempt's amount is decided; the refund by hand lands right after.
    if (name === "start_refund_due_attempt_v3" && !landed) { landed = true; onCharge.push(...appears); }
    return answer;
  }) as never);
  const { client, calls } = fakeStripe({ currency: "mxn" });
  const create = calls.create.getMockImplementation()!;
  calls.create.mockImplementation(async params => {
    const made = await create(params);
    onCharge.push({ id: made.id, amount: Number(params.amount), status: made.status, metadata: params.metadata as Stripe.Metadata });
    return made;
  });
  calls.list.mockImplementation(() => Object.assign(Promise.resolve({ data: onCharge }), {
    async *[Symbol.asyncIterator]() { yield* onCharge; },
  }) as never);
  calls.intent.mockImplementation(async () => {
    const refunded = onCharge.filter(r => r.status !== "failed").reduce((sum, r) => sum + r.amount, 0);
    return { currency: "mxn", latest_charge: { amount: chargeCents, amount_refunded: refunded, application_fee: "fee_1" } } as never;
  });
  const run = () => refundDue(db, "r1", "d1", "manager", client);
  const returned = () => onCharge.filter(r => r.status === "succeeded").reduce((sum, r) => sum + r.amount, 0);
  return { rows, rpc, calls, run, onCharge, returned, ledger: fakeLedger(rows) };
}

const byHand = (id: string, amount: number, status = "succeeded"): Made => ({ id, amount, status, metadata: {} } as Made);

it("counts a MX$40 refund made by hand mid-send and sends only the MX$60 still owed", async () => {
  const { run, calls, returned, rows, ledger } = race(20000, [byHand("re_hand", 4000)]);
  expect(await run()).toMatchObject({ ok: true, amount: 60 });
  expect(calls.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ amount: 6000 }),
    expect.objectContaining({ idempotencyKey: "refund-due-d1-2", stripeAccount: "acct_1" }));
  expect(returned()).toBe(10000);
  expect(rows[0].refunded_at).toEqual(expect.any(String));
  expect(ledger.attempts.get("d1")).toMatchObject({ attempt_no: 2, amount: 60 });
  // A retry finds the refund by its tag and never sends again.
  await run();
  expect(calls.create).toHaveBeenCalledTimes(1);
});

it("sends nothing while a refund made by hand is pending, then sends the whole due once it fails", async () => {
  const pending = byHand("re_hand", 4000, "pending");
  const { run, calls, returned, rows, onCharge } = race(20000, [pending]);
  expect(await run()).toMatchObject({ ok: false, error: "apiErr.refundPending", status: 409 });
  expect(calls.create).not.toHaveBeenCalled();
  expect(rows[0].refunded_at).toBeNull();
  // Not lost: the diner is still owed, and once Stripe fails that refund the
  // frozen attempt goes out as decided.
  onCharge[0] = { ...pending, status: "failed" };
  expect(await run()).toMatchObject({ ok: true, amount: 100 });
  expect(calls.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ amount: 10000 }),
    expect.objectContaining({ idempotencyKey: "refund-due-d1" }));
  expect(returned()).toBe(10000);
});

it("closes the due without a POST when the refund made by hand covers all of it", async () => {
  const { run, calls, rows } = race(20000, [byHand("re_hand", 10000)]);
  expect(await run()).toMatchObject({ ok: true, alreadyInStripe: true });
  expect(calls.create).not.toHaveBeenCalled();
  expect(rows[0].refunded_at).toEqual(expect.any(String));
});

it("stops for review when the diner is still owed and the charge has nothing left", async () => {
  const returnRefund = { id: "re_return", amount: 6000, status: "succeeded", metadata: { refund_operation: "op1" } } as Made;
  const { run, calls, rows, ledger } = race(10000, [byHand("re_hand", 4000), returnRefund]);
  expect(await run()).toMatchObject({ ok: false, error: "apiErr.refundPending", status: 409 });
  expect(calls.create).not.toHaveBeenCalled();
  expect(rows[0].refunded_at).toBeNull();
  expect(ledger.reviews.get("d1")).toBe(6000);
});
