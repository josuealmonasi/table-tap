import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { reconcileDueFee } from "../due-recovery";

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: verify }) }));
const attempt = { id: "customer-attempt", attempt_no: 1, idempotency_key: "customer-key", amount: 100,
  stripe_account_id: "acct_original", stripe_payment_intent: "pi_original", stripe_refund_id: "re_customer" };
interface Request { fee_id: string; amount: number; attempt_no?: number }

function recovery(currency = "MXN") {
  const row = { fee_request: null as Request | null, fee_request_history: [] as Request[],
    fee_verification_pending: false, fee_target_cents: null as number | null, fee_reconciled_at: null as string | null };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "verify_refunded_platform_fee") {
      row.fee_target_cents = Number(args.p_target);
      row.fee_verification_pending = Number(args.p_cents) < Number(args.p_target);
      row.fee_reconciled_at = row.fee_verification_pending ? null : "2026-10-27T12:00:00Z";
      return { data: null, error: null };
    }
    if (name === "start_refund_due_fee") row.fee_request ??= { fee_id: String(args.p_fee), amount: Number(args.p_amount) };
    if (name === "advance_refund_due_fee") {
      if (JSON.stringify(args.p_previous) !== JSON.stringify(row.fee_request)) return { data: null, error: null };
      row.fee_request_history.push(row.fee_request!);
      row.fee_request = { fee_id: "fee_original", amount: Number(args.p_target) - Number(args.p_returned),
        attempt_no: (row.fee_request?.attempt_no ?? 1) + 1 };
    }
    return { data: row.fee_request, error: null };
  });
  verify.mockImplementation(rpc);
  const db = { rpc, from: () => {
    const q = { update: (patch: object) => { Object.assign(row, patch); return q; },
      select: () => q, eq: () => q, not: () => q, or: () => q, maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve: (result: object) => void) => resolve({ error: null }) };
    return q;
  } } as unknown as ReturnType<typeof createAdminClient>;
  let returned = 0;
  let customerReturned = 10000;
  const made: { id: string; amount: number; metadata: Record<string, string> }[] = [];
  const fee = vi.fn(async () => ({ amount: 300, amount_refunded: returned }));
  const feeList = vi.fn(() => (async function* () { yield* made; })());
  const feeRefund = vi.fn(async (_fee: string, params: { amount: number; metadata: Record<string, string> }) => {
    if (params.amount > 300 - returned) throw new Error("amount exceeds the remaining fee");
    returned += params.amount;
    const refund = { id: `fr_${made.length + 1}`, ...params }; made.push(refund); return refund;
  });
  const intent = vi.fn(async () => ({ currency: currency.toLowerCase(),
    latest_charge: { amount: 10000, application_fee: "fee_original" as string | null } }));
  const client = { paymentIntents: { retrieve: intent }, refunds: {
    list: () => (async function* () { yield { id: "re_customer", amount: customerReturned, status: "succeeded" }; })(),
  }, applicationFees: { retrieve: fee, listRefunds: feeList, createRefund: feeRefund } } as unknown as Stripe;
  return { row, rpc, db, client, intent, feeRefund, feeList, fee,
    separatelyReturn: (cents: number) => { returned += cents; },
    customerReturns: (cents: number) => { customerReturned = cents; }, returned: () => returned };
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

it("finding 2: records unknown fee verification before the first provider read can fail", async () => {
  const r = recovery();
  r.intent.mockImplementationOnce(async () => {
    expect(r.row.fee_verification_pending).toBe(true);
    throw new Error("provider unavailable before prepare");
  });
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(false);
  expect(r.row).toMatchObject({ fee_request: null, fee_target_cents: null, fee_verification_pending: true, fee_reconciled_at: null });
});

it.each(["no fee", "fully returned"])("finding 2: verifies %s without leaving deletion blocked", async kind => {
  const r = recovery();
  if (kind === "no fee") r.intent.mockResolvedValue({ currency: "mxn", latest_charge: { amount: 10000, application_fee: null } });
  else r.separatelyReturn(300);
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(true);
  expect(r.row.fee_verification_pending).toBe(false);
  expect(r.row.fee_target_cents).toBe(kind === "no fee" ? 0 : 300);
  expect(r.row.fee_reconciled_at).toEqual(expect.any(String));
  expect(r.feeRefund).not.toHaveBeenCalled();
});

it.each(["MXN", "USD"])("finding 4: %s 100 with 3 owed and 1 separately returned retries 2 exactly once", async currency => {
  const r = recovery(currency);
  r.feeRefund.mockRejectedValueOnce(new Error("lost connection before provider applied request"));
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(false);
  expect(r.row.fee_request).toMatchObject({ amount: 300 });
  r.separatelyReturn(100);
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(true);
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(true);
  expect(r.row.fee_request_history).toEqual([{ fee_id: "fee_original", amount: 300 }]);
  expect(r.row.fee_target_cents).toBe(300);
  expect(r.feeRefund.mock.calls.map(call => call[1].amount)).toEqual([300, 200]);
  expect(r.returned()).toBe(300);
  expect(r.feeRefund).toHaveBeenLastCalledWith("fee_original", { amount: 200,
    metadata: { refund_due: "due", refund_due_fee_attempt: "2" } }, { idempotencyKey: "refund-due-fee-due-2" });
  const advance = r.rpc.mock.invocationCallOrder[r.rpc.mock.calls.findIndex(call => call[0] === "advance_refund_due_fee")];
  expect(r.feeList.mock.invocationCallOrder[1]).toBeLessThan(advance);
});

it("recovers a lost response on the replacement attempt without returning another 2", async () => {
  const r = recovery();
  r.feeRefund.mockRejectedValueOnce(new Error("unavailable"));
  await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client);
  r.separatelyReturn(100);
  const create = r.feeRefund.getMockImplementation()!;
  r.feeRefund.mockImplementationOnce(async (...args) => { await create(...args); throw new Error("lost response"); });
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(false);
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(true);
  expect(r.feeRefund).toHaveBeenCalledTimes(2);
});

it("keeps an unknown partial request when it could still land, rather than over-returning the target", async () => {
  const r = recovery();
  r.customerReturns(5000);
  r.feeRefund.mockRejectedValueOnce(new Error("unknown provider outcome"));
  const partial = { ...attempt, amount: 50 };
  expect(await reconcileDueFee(r.db, "restaurant", "due", partial, r.client)).toBe(false);
  r.separatelyReturn(50);
  expect(await reconcileDueFee(r.db, "restaurant", "due", partial, r.client)).toBe(false);
  expect(r.row.fee_request).toMatchObject({ amount: 150 });
  expect(r.row.fee_request_history).toEqual([]);
  expect(r.feeRefund).toHaveBeenCalledTimes(1);
});

it("reconciles a completed original attempt before saving another attempt toward a larger target", async () => {
  const r = recovery();
  r.row.fee_request = { fee_id: "fee_original", amount: 100 };
  r.separatelyReturn(100);
  r.feeList.mockImplementation(() => (async function* () {
    yield { id: "fr_original", amount: 100, metadata: { refund_due: "due" } };
  })());
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(true);
  expect(r.rpc).toHaveBeenCalledWith("advance_refund_due_fee", expect.objectContaining({ p_refund: "fr_original" }));
  expect(r.feeRefund.mock.calls.map(call => call[1].amount)).toEqual([200]);
  expect(r.returned()).toBe(300);
});

it("keeps the original durable request if listing provider evidence fails", async () => {
  const r = recovery();
  r.row.fee_request = { fee_id: "fee_original", amount: 300 };
  r.separatelyReturn(100);
  r.feeList.mockImplementationOnce(() => (async function* () { throw new Error("provider list unavailable"); })());
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(false);
  expect(r.row.fee_request_history).toEqual([]);
  expect(r.feeRefund).not.toHaveBeenCalled();
});

it("concurrent retries share one replacement attempt and a delayed original can no longer land", async () => {
  const r = recovery();
  r.feeRefund.mockRejectedValueOnce(new Error("unavailable"));
  await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client);
  r.separatelyReturn(100);
  const answers = await Promise.all([1, 2].map(() => reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)));
  expect(answers).toContain(true);
  expect(r.row.fee_request_history).toHaveLength(1);
  expect(r.feeRefund.mock.calls.map(call => call[1].amount)).toEqual([300, 200]);
  await expect(r.feeRefund("fee_original", { amount: 300, metadata: { refund_due: "due" } }))
    .rejects.toThrow("amount exceeds the remaining fee");
  expect(r.returned()).toBe(300);
});
