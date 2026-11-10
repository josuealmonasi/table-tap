import { beforeEach, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripe: { paymentIntents: { retrieve: provider.retrieve } } }));
import { withProcessingFees } from "@/lib/costs/processing-fees";
import { feeRate } from "@/lib/costs/fees";
const payments = [60, 40].map(amount => ({ amount, currency: "USD", method: "card" as const,
  stripe_payment_intent: "pi_1", stripe_account_id: "acct_original" }));
beforeEach(() => {
  provider.retrieve.mockReset();
  provider.retrieve.mockResolvedValue({ latest_charge: { paid: true, currency: "usd",
    balance_transaction: { currency: "mxn", fee: 600, exchange_rate: 20,
      fee_details: [{ type: "stripe_fee", amount: 400 }, { type: "application_fee", amount: 200 }] } } });
});
it("D4: converts provider fees with the original settlement rate and counts one charge once", async () => {
  const priced = await withProcessingFees(payments);
  expect(feeRate(priced, 0.1, 0).fees).toBeCloseTo(0.3);
  expect(provider.retrieve).toHaveBeenCalledExactlyOnceWith("pi_1", { expand: ["latest_charge.balance_transaction"] }, { stripeAccount: "acct_original" });
});
it("D4: keeps pesos on the MXN estimate without fetching provider data", async () => {
  const pesos = payments.map(p => ({ ...p, currency: "MXN" }));
  expect(await withProcessingFees(pesos)).toBe(pesos);
  expect(provider.retrieve).not.toHaveBeenCalled();
});
it("D4: missing currency conversion evidence fails the report instead of mixing money", async () => {
  provider.retrieve.mockResolvedValue({ latest_charge: { paid: true, currency: "usd",
    balance_transaction: { currency: "mxn", fee: 600, exchange_rate: null, fee_details: [] } } });
  await expect(withProcessingFees(payments)).rejects.toThrow("currency evidence");
});
it("D4: missing original connected-account evidence never borrows today's account", async () => {
  await expect(withProcessingFees(payments.map(p => ({ ...p, stripe_account_id: null })))).rejects.toThrow("account evidence");
  expect(provider.retrieve).not.toHaveBeenCalled();
});
