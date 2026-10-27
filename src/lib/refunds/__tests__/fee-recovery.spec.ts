import { beforeEach, expect, it, vi } from "vitest";
import { reconcileDueFee } from "../due-recovery";
import { chargeFixture } from "./charge-contract-fixtures";
const attempt = { id: "customer-attempt", attempt_no: 1, idempotency_key: "customer-key", amount: 100,
  stripe_account_id: "acct", stripe_payment_intent: "pi", stripe_refund_id: "re_customer" };
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => {}); });
const run = (f: ReturnType<typeof chargeFixture>) => reconcileDueFee(f.db, "r", "due", attempt, f.client);

it("finding 2: records unknown fee verification before the first provider read can fail", async () => {
  const f = chargeFixture("mxn");
  vi.mocked(f.client.paymentIntents.retrieve).mockImplementationOnce(async () => {
    expect(f.row.fee_verification_pending).toBe(true); throw new Error("provider unavailable before prepare");
  });
  expect(await run(f)).toBe(false);
  expect(f.row).toMatchObject({ fee_target_cents: null, fee_verification_pending: true, fee_reconciled_at: null });
  expect(f.requests).toEqual([]);
});
it.each(["no fee", "fully returned"])("finding 2: verifies %s without leaving deletion blocked", async kind => {
  const f = chargeFixture("mxn");
  if (kind === "no fee") vi.mocked(f.client.paymentIntents.retrieve).mockResolvedValue({ latest_charge: { amount: 10000, application_fee: null } } as never);
  else f.returned = 180;
  expect(await run(f)).toBe(true);
  expect(f.row).toMatchObject({ fee_verification_pending: false, fee_target_cents: kind === "no fee" ? 0 : 180, fee_reconciled_at: expect.any(String) });
  expect(f.createRefund).not.toHaveBeenCalled();
});
it.each(["mxn", "usd"])("finding 4: %s unknown request never permits replacement after a separate fee return", async currency => {
  const f = chargeFixture(currency); f.refunds[0].amount = 10000;
  f.createRefund.mockRejectedValueOnce(new Error("lost connection before provider applied request"));
  expect(await run(f)).toBe(false); f.returned = 100; f.age(2);
  expect(await run(f)).toBe(false); expect(await run(f)).toBe(false);
  expect(f.requests).toHaveLength(1); expect(f.requests[0].amount_cents).toBe(300);
  expect(f.createRefund).toHaveBeenCalledTimes(1); expect(f.row.fee_verification_pending).toBe(true);
});
it("recovers a lost response without returning the fee again", async () => {
  const f = chargeFixture("usd"); const create = f.createRefund.getMockImplementation()!;
  f.createRefund.mockImplementationOnce(async (...args) => { await create(...args); throw new Error("lost response"); });
  expect(await run(f)).toBe(false); expect(await run(f)).toBe(true);
  expect(f.createRefund).toHaveBeenCalledTimes(1); expect(f.returned).toBe(180);
});
it("keeps an unknown partial request when it could still land, rather than over-returning the target", async () => {
  const f = chargeFixture("mxn"); f.refunds[0].amount = 5000;
  f.createRefund.mockRejectedValueOnce(new Error("unknown provider outcome"));
  expect(await run(f)).toBe(false); f.returned = 50; f.age(2);
  expect(await run(f)).toBe(false); expect(f.requests[0]).toMatchObject({ amount_cents: 150, status: "dispatched" });
  expect(f.createRefund).toHaveBeenCalledTimes(1);
});
it("reconciles a completed original attempt before preparing another toward a larger target", async () => {
  const f = chargeFixture("mxn"); const row = f.seed("dispatched", 100); f.returned = 100;
  f.evidence.push({ id: "fr_original", amount: 100, currency: "mxn", metadata: { fee_return: row.id } });
  expect(await run(f)).toBe(true);
  expect(f.rpc).toHaveBeenCalledWith("record_fee_return", expect.objectContaining({ p_provider_refund: "fr_original" }));
  expect(f.createRefund.mock.calls.map(call => call[1].amount)).toEqual([80]); expect(f.returned).toBe(180);
});
it("keeps the original durable request if listing provider evidence fails", async () => {
  const f = chargeFixture("usd"); f.seed("dispatched");
  f.feePages.mockImplementationOnce(() => (async function* () { throw new Error("provider list unavailable"); })());
  expect(await run(f)).toBe(false); expect(f.requests).toHaveLength(1); expect(f.createRefund).not.toHaveBeenCalled();
});
it("concurrent retries share one reclaimed attempt and its key", async () => {
  const f = chargeFixture("mxn"); const row = f.seed("dispatched"); f.age(2);
  await Promise.all([run(f), run(f)]);
  expect(f.requests).toHaveLength(1); expect(f.createRefund).toHaveBeenCalledTimes(1);
  expect(f.createRefund.mock.calls[0][2]).toEqual({ idempotencyKey: row.idempotency_key }); expect(f.returned).toBe(180);
});
