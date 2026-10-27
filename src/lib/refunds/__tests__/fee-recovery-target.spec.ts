import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { reconcileDueFee } from "../due-recovery";
import { chargeFixture } from "./charge-contract-fixtures";
const attempt = { id: "customer-attempt", attempt_no: 1, idempotency_key: "customer-key", amount: 10,
  stripe_account_id: "acct", stripe_payment_intent: "pi", stripe_refund_id: "re_customer" };
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });
const run = (f: ReturnType<typeof chargeFixture>) => reconcileDueFee(f.db, "r", "due", attempt, f.client);

it.each(["mxn", "usd"])("M1: %s rechecks a late 270-cent remainder and returns it exactly once", async currency => {
  const f = chargeFixture(currency); f.refunds[0].amount = 1000;
  const create = f.createRefund.getMockImplementation()!;
  f.createRefund.mockImplementationOnce(async (...args) => {
    const made = await create(...args);
    f.refunds.push({ id: "re_manual", status: "succeeded", amount: 9000 }); return made;
  });
  expect(await run(f)).toBe(true); expect(await run(f)).toBe(true);
  expect(f.rpc).toHaveBeenCalledWith("verify_refunded_platform_fee_v2", expect.objectContaining({
    p_cents: 30, p_target: 300, p_refunds: ["re_60", "re_manual"],
  }));
  expect(f.returned).toBe(300); expect(f.createRefund.mock.calls.map(call => call[1].amount)).toEqual([30, 270]);
  expect(f.requests).toHaveLength(2);
  expect(f.row).toMatchObject({ fee_target_cents: 300, fee_verification_pending: false, fee_reconciled_at: expect.any(String) });
});
it("M1: a failed final verification leaves the fee pending for recovery", async () => {
  const f = chargeFixture("mxn"); const original = f.rpc.getMockImplementation()!;
  f.rpc.mockImplementationOnce(async () => ({ data: null, error: { message: "database unavailable" } }) as never);
  expect(await run(f)).toBe(false); expect(f.row.fee_verification_pending).toBe(true);
  f.rpc.mockImplementation(original); expect(await run(f)).toBe(true); expect(f.createRefund).toHaveBeenCalledTimes(1);
});
it.each(["missing", "failed"])("M1: an unreadable %s saved outcome cannot report success", async kind => {
  const f = chargeFixture("usd");
  f.read.mockResolvedValueOnce({ data: null, error: kind === "failed" ? { message: "read failed" } : null });
  expect(await run(f)).toBe(false); expect(await run(f)).toBe(true); expect(f.createRefund).toHaveBeenCalledTimes(1);
});

it("M1: due fee completion uses the final verified amounts under the money lock", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const body = sql.slice(sql.lastIndexOf("create or replace function public.apply_verified_platform_fee(")).split("$$;")[0];
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
