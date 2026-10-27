import { beforeEach, expect, it, vi } from "vitest";
import { due, fakeDb, fakeStripe, fakeLedger, feeVerification } from "./refund-due-fixtures";
import type Stripe from "stripe";
import { syncReturnedFee } from "@/lib/refunds/fee";

const state = vi.hoisted(() => ({ tasks: [] as (() => Promise<void>)[], db: null as ReturnType<typeof fakeDb> | null }));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => state.tasks.push(task) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db ?? { rpc: feeVerification } }));
vi.mock("@/lib/activity-log", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/refunds/fee", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/refunds/fee")>();
  return { syncReturnedFee: vi.fn(actual.syncReturnedFee) };
});
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
import { recoverQueuedFees } from "@/lib/refunds/fee-queue";
import { recoverRefundDues, refundsDue } from "@/lib/refunds/due-list";

beforeEach(() => { state.tasks.length = 0; state.db = null; vi.clearAllMocks(); });

it("lists customer-complete fees without waiting for Stripe", async () => {
  state.db = fakeDb([due({ currency: "USD", refunded_at: "2026-10-01" }),
    due({ id: "complete", currency: "USD", refunded_at: "2026-10-01", fee_reconciled_at: "2026-10-02" })]);
  expect((await refundsDue("r1")).map(r => r.id)).toEqual(["d1"]);
  expect(state.tasks).toHaveLength(1);
  expect(syncReturnedFee).not.toHaveBeenCalled();
});

it("recovers a persisted fee after restart without another customer refund", async () => {
  const rows = [due({ currency: "USD", refunded_at: "2026-10-01", stripe_refund_id: "re_old" })];
  const { client, calls } = fakeStripe({ made: [{ id: "re_old", amount: 12550, status: "succeeded" } as Stripe.Refund] });
  await recoverRefundDues("r1", fakeDb(rows), client);
  expect(rows[0].fee_reconciled_at).toEqual(expect.any(String));
  expect(calls.create).not.toHaveBeenCalled();
  expect(syncReturnedFee).toHaveBeenCalledTimes(1);
});

it("verifies older charge currency in the background without giving back money before approval", async () => {
  const rows = [due({ currency: null })];
  const { client, calls } = fakeStripe();
  await recoverRefundDues("r1", fakeDb(rows), client);
  expect(rows[0].currency).toBe("USD");
  expect(rows[0].refunded_at).toBeNull();
  expect(calls.create).not.toHaveBeenCalled();
  expect(calls.feeRefund).not.toHaveBeenCalled();
});

it("leaves a stale recovery pending when an enqueue moves its revision during the provider read", async () => {
  const rows = [due({ currency: "USD", refunded_at: "2026-10-01", stripe_refund_id: "re_old" })];
  const db = fakeDb(rows);
  const charge = { p_restaurant: "r1", p_intent: "pi_1" };
  await db.rpc("enqueue_fee_reconcile", charge);
  const { client, calls } = fakeStripe({ made: [{ id: "re_old", amount: 12550, status: "succeeded" } as Stripe.Refund] });
  const read = calls.intent.getMockImplementation()!;
  calls.intent.mockImplementationOnce(async () => { await db.rpc("enqueue_fee_reconcile", charge); return read(); });
  await recoverRefundDues("r1", db, client);
  expect(rows[0]).toMatchObject({ fee_verification_pending: true });
  expect(rows[0].fee_reconciled_at).toBeUndefined();
  expect(fakeLedger(rows).returns).toHaveLength(0);
  expect(fakeLedger(rows).queue).toEqual([{ restaurant_id: "r1", stripe_payment_intent: "pi_1", generation: 2 }]);
  expect(calls.feeRefund).not.toHaveBeenCalled();
  await recoverRefundDues("r1", fakeDb(rows), client);
  expect(rows[0].fee_reconciled_at).toEqual(expect.any(String));
  expect(fakeLedger(rows).queue).toHaveLength(0);
});

it("keeps a newer enqueue through duplicate recovery and lets charge recovery acknowledge it", async () => {
  const rows = [due({ currency: "USD", refunded_at: "2026-10-01", stripe_refund_id: "re_old" })];
  const db = fakeDb(rows);
  const charge = { p_restaurant: "r1", p_intent: "pi_1" };
  await db.rpc("enqueue_fee_reconcile", charge);
  const { client, calls } = fakeStripe({ made: [{ id: "re_old", amount: 12550, status: "succeeded" } as Stripe.Refund] });
  const send = calls.feeRefund.getMockImplementation()!;
  let newer: number | undefined;
  calls.feeRefund.mockImplementationOnce(async (...args) => {
    const made = await send(...args);
    newer = (await db.rpc("enqueue_fee_reconcile", charge)).data;
    return made;
  });
  await recoverRefundDues("r1", db, client);
  expect(rows[0].fee_reconciled_at).toEqual(expect.any(String));
  expect(fakeLedger(rows).queue).toEqual([{ restaurant_id: "r1", stripe_payment_intent: "pi_1", generation: newer }]);
  await recoverQueuedFees(fakeDb(rows), client, "r1");
  expect(fakeLedger(rows).queue).toHaveLength(0);
  expect(calls.feeRefund).toHaveBeenCalledTimes(1);
  expect(calls.create).not.toHaveBeenCalled();
});
