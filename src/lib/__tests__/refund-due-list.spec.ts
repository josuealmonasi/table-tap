import { beforeEach, expect, it, vi } from "vitest";
import { due, fakeDb, fakeStripe, feeVerification } from "./refund-due-fixtures";
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
