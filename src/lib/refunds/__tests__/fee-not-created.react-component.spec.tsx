import { expect, it, vi } from "vitest";
import { reconcileChargeFee } from "../charge-reconciler";
import { chargeFixture } from "./charge-contract-fixtures";

const run = (f: ReturnType<typeof chargeFixture>) => reconcileChargeFee(f.db, f.client, "r", "pi", "acct");
function setup() {
  const f = chargeFixture("mxn");
  f.refunds[0].amount = 10000;
  vi.mocked(f.client.paymentIntents.retrieve).mockResolvedValueOnce({ latest_charge: { amount: 10000, application_fee: null } } as never);
  return f;
}

it.each(["ledger", "checkout metadata", "saved request"])("F1 keeps the full refund pending when %s proves a 300-cent fee", async source => {
  const f = setup();
  if (source === "ledger") f.feeEvidence.ledger = [{ cents: 300 }];
  else f.feeEvidence.checkouts = [source === "checkout metadata" ? { metadata: { fee_cents: "300" } }
    : { metadata: {}, stripe_params: { payment_intent_data: { application_fee_amount: 300 } } }];
  await expect(run(f)).rejects.toThrow("Platform fee not created yet");
  expect(f.rpc.mock.calls.some(([name]) => ["verify_refunded_platform_fee_v2", "ack_fee_reconcile"].includes(name))).toBe(false);
  expect(f.generation).toBe(0);
  expect(f.row.fee_reconciled_at).toBeNull();
  // Stripe exposes the object on recovery: return all 300 cents, then ack.
  expect(await run(f)).toBe(true);
  expect(f.returned).toBe(300);
  expect(f.generation).toBeNull();
});

it("F1 preserves verified zero-fee checkout behaviour", async () => {
  const f = setup();
  expect(await run(f)).toBe(true);
  expect(f.rpc).toHaveBeenCalledWith("verify_refunded_platform_fee_v2", expect.objectContaining({ p_target: 0, p_cents: 0 }));
  expect(f.generation).toBeNull();
  expect(f.createRefund).not.toHaveBeenCalled();
});

// No saved fee anywhere (ceiling reached, an account or legacy checkout): a
// free charge. Holding it pending until a zero was "proven" kept it queued for
// good, and a queued fee blocks deleting the restaurant.
it("F1 a charge with no saved fee evidence is free, reconciled and acknowledged", async () => {
  const f = setup(); f.feeEvidence.checkouts = [];
  await run(f);
  expect(f.generation).toBeNull();
});

it("F1 a saved zero cannot override a positive fee on another checkout row", async () => {
  const f = setup();
  f.feeEvidence.checkouts.push({ metadata: { fee_cents: "300" } });
  await expect(run(f)).rejects.toThrow("Platform fee not created yet");
  expect(f.generation).toBe(0);
});

it("F1 unreadable fee evidence never verifies or acknowledges", async () => {
  const f = setup(); const original = f.from.getMockImplementation()!;
  f.from.mockImplementation((table: string) => {
    const q = original(table);
    if (table === "platform_fees") vi.spyOn(q, "range").mockResolvedValue({ data: null, error: { message: "saved fee unavailable" } } as never);
    return q;
  });
  await expect(run(f)).rejects.toThrow("saved fee unavailable");
  expect(f.generation).toBe(0);
  expect(f.row.fee_reconciled_at).toBeNull();
});
