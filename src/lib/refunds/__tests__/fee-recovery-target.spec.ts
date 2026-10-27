import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { reconcileDueFee } from "../due-recovery";

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: verify }) }));

const attempt = { id: "customer-attempt", attempt_no: 1, idempotency_key: "customer-key", amount: 10,
  stripe_account_id: "acct_original", stripe_payment_intent: "pi_original", stripe_refund_id: "re_customer" };

function recovery(currency: string) {
  const row = { fee_request: null as { fee_id: string; amount: number; attempt_no?: number } | null,
    fee_request_history: [] as object[], fee_target_cents: null as number | null,
    fee_verification_pending: true, fee_reconciled_at: null as string | null };
  let returned = 0;
  let customerReturned = 1000;
  const made: { id: string; amount: number; metadata: Record<string, string> }[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "start_refund_due_fee") row.fee_request ??= { fee_id: String(args.p_fee), amount: Number(args.p_amount) };
    if (name === "advance_refund_due_fee") {
      if (JSON.stringify(row.fee_request) !== JSON.stringify(args.p_previous)) return { data: null, error: null };
      row.fee_request_history.push(row.fee_request!);
      row.fee_request = { fee_id: "fee_original", amount: Number(args.p_target) - Number(args.p_returned),
        attempt_no: (row.fee_request?.attempt_no ?? 1) + 1 };
    }
    return { data: row.fee_request, error: null };
  });
  const read = vi.fn(async (): Promise<{ data: object | null; error: { message: string } | null }> => ({ data: { ...row }, error: null }));
  const db = { rpc, from: () => {
    const query = { update: (patch: object) => { Object.assign(row, patch); return query; },
      select: () => query, eq: () => query, not: () => query, or: () => query, maybeSingle: read,
      then: (resolve: (result: object) => void) => resolve({ error: null }) };
    return query;
  } } as unknown as ReturnType<typeof createAdminClient>;
  // Model the final locked write. The schema assertion below checks its SQL.
  verify.mockImplementation(async (name: string, args: { p_cents: number; p_target: number }) => {
    if (name === "refund_fee_epoch") return { data: 0, error: null };
    row.fee_target_cents = args.p_target;
    row.fee_verification_pending = args.p_cents < args.p_target;
    row.fee_reconciled_at = row.fee_verification_pending ? null : "2026-10-27T12:00:00Z";
    return { data: true, error: null };
  });
  const feeRefund = vi.fn(async (_fee: string, params: { amount: number; metadata: Record<string, string> }) => {
    returned += params.amount;
    const refund = { id: `fr_${made.length + 1}`, ...params };
    made.push(refund);
    return refund;
  });
  const intent = vi.fn(async () => ({ currency: currency.toLowerCase(),
    latest_charge: { amount: 10000, application_fee: "fee_original" as string | null } }));
  const fee = vi.fn(async () => ({ amount: 300, amount_refunded: returned }));
  const client = { paymentIntents: { retrieve: intent }, refunds: {
    list: () => (async function* () {
      yield { id: "re_customer", status: "succeeded", amount: 1000 };
      if (customerReturned > 1000) yield { id: "re_manual", status: "succeeded", amount: customerReturned - 1000 };
    })(),
  }, applicationFees: { retrieve: fee, createRefund: feeRefund,
    listRefunds: () => (async function* () { yield* made; })() } } as unknown as Stripe;
  return { row, db, client, rpc, read, feeRefund, fee, intent,
    customerReturns: (cents: number) => { customerReturned = cents; }, returned: () => returned };
}

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });

it.each(["MXN", "USD"])("M1: %s keeps a late 270-cent fee remainder pending, then returns it exactly once", async currency => {
  const r = recovery(currency);
  const create = r.feeRefund.getMockImplementation()!;
  r.feeRefund.mockImplementationOnce(async (...args) => {
    const result = await create(...args);
    r.customerReturns(10000);
    return result;
  });
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(false);
  expect(verify).toHaveBeenLastCalledWith("verify_refunded_platform_fee_v2", {
    p_restaurant: "restaurant", p_intent: "pi_original", p_cents: 30, p_target: 300, p_refunds: ["re_customer", "re_manual"], p_epoch: 0,
  });
  expect(r.row).toMatchObject({ fee_target_cents: 300, fee_verification_pending: true, fee_reconciled_at: null });
  expect(r.returned()).toBe(30);

  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(true);
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(true);
  expect(r.returned()).toBe(300);
  expect(r.feeRefund.mock.calls.map(call => call[1].amount)).toEqual([30, 270]);
  expect(r.row.fee_request_history).toHaveLength(1);
  expect(r.feeRefund).toHaveBeenLastCalledWith("fee_original", { amount: 270,
    metadata: { refund_due: "due", refund_due_fee_attempt: "2" } }, { idempotencyKey: "refund-due-fee-due-2" });
  expect(r.row).toMatchObject({ fee_target_cents: 300, fee_verification_pending: false, fee_reconciled_at: expect.any(String) });
});

it("M1: a failed final verification leaves the fee pending for recovery", async () => {
  const r = recovery("MXN");
  verify.mockResolvedValueOnce({ error: { message: "database unavailable" } });
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(false);
  expect(r.row).toMatchObject({ fee_verification_pending: true, fee_reconciled_at: null });
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(true);
  expect(r.feeRefund).toHaveBeenCalledTimes(1);
});

it.each(["missing", "failed"])("M1: an unreadable %s saved outcome cannot report success", async kind => {
  const r = recovery("USD");
  r.read.mockResolvedValueOnce({ data: null, error: kind === "failed" ? { message: "read failed" } : null });
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(false);
  expect(await reconcileDueFee(r.db, "restaurant", "due", attempt, r.client)).toBe(true);
  expect(r.feeRefund).toHaveBeenCalledTimes(1);
});

it("M1: due fee completion uses the final verified amounts under the money lock", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const body = sql.slice(sql.lastIndexOf("create or replace function public.verify_refunded_platform_fee(")).split("$$;")[0];
  const update = body.slice(body.indexOf("update refunds_due"));
  expect(body).toContain("update refunds_due");
  expect(body.indexOf("lock_restaurant_money(p_restaurant)")).toBeLessThan(body.indexOf("update refunds_due"));
  // Audit N 1: a stale snapshot can neither lower the target nor finish early.
  expect(body.indexOf("max(refunded_cents)")).toBeLessThan(body.indexOf("update refund_operations"));
  for (const table of ["update refund_operations", "update refunds_due"]) {
    const set = body.slice(body.indexOf(table)).split("where")[0];
    expect(set).toContain("fee_target_cents = greatest(coalesce(fee_target_cents, 0), p_target)");
    expect(set).toContain("fee_verification_pending = (v_returned < greatest(coalesce(fee_target_cents, 0), p_target))");
    expect(set).toContain("then coalesce(fee_reconciled_at, now()) end");
    expect(set).not.toMatch(/fee_target_cents = p_target|p_cents [<>]=? p_target/);
  }
  expect(update).toContain("restaurant_id = p_restaurant and stripe_payment_intent = p_intent");
  expect(update).toContain("refunded_at is not null");
  expect(update).toContain("stripe_refund_id = any(p_refunds)");
  expect(sql).toContain("revoke all on function public.verify_refunded_platform_fee(uuid, text, int, int, text[]) from public, anon, authenticated;");
});
