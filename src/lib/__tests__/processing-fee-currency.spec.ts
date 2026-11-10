import { expect, it } from "vitest";
import { paymentFee, feeRate } from "@/lib/costs/fees";
it("D4: never estimates a USD payment using a fixed MXN3 fee", () => {
  expect(() => paymentFee({ amount: 100, currency: "USD", method: "card", stripe_payment_intent: "pi_usd" }, 0)).toThrow();
});
it("D4: uses the provider's processing fee in the payment currency", () => {
  expect(paymentFee({ amount: 100, currency: "USD", processing_fee: 0.75, method: "card", stripe_payment_intent: "pi_usd" }, 0)).toBe(0.75);
});
it("D4: allocated provider fees do not subtract another peso fixed fee on the second payment", () => {
  expect(feeRate([60, 40].map(amount => ({ amount, currency: "USD", processing_fee: amount * 0.01, method: "card" as const, stripe_payment_intent: "pi_usd" })), 0, 0).fees).toBe(1);
});
