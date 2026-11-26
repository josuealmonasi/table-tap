import { describe, expect, it } from "vitest";
import { cancelSummary, type CancelPayment } from "@/lib/cancel-plan";

const order = { paid: true, total: 350, currency: "MXN" };
const payment = (overrides: Partial<CancelPayment> = {}): CancelPayment => ({
  amount: 350, method: "card", currency: "MXN", allocation_quality: "exact",
  stripe_payment_intent: "pi_1", stripe_account_id: "acct_1", ...overrides,
});

describe("cancellation uses the refund writer's sources", () => {
  it("uses the retained amount of exact Stripe coverage for an order that is only partially paid", () => {
    expect(cancelSummary({ ...order, paid: false }, [payment({ amount: "20.50" })]))
      .toMatchObject({ paid: true, refund: 20.5 });
  });

  it.each([
    { stripe_account_id: null }, { allocation_quality: "estimated" }, { currency: null }, { currency: "USD" },
  ])("sends unsupported Stripe evidence to review: %j", overrides => {
    expect(cancelSummary(order, [payment(overrides)])).toMatchObject({
      refund: 0, cash: 0, terminal: 0, review: [{ amount: 350, currency: overrides.currency ?? "MXN" }],
    });
  });

  it("shows the cash and terminal amounts separately from the Stripe refund", () => {
    expect(cancelSummary(order, [
      payment({ amount: 250 }),
      payment({ amount: 70, method: "cash", stripe_payment_intent: null }),
      payment({ amount: 30, stripe_payment_intent: null }),
    ])).toMatchObject({ paid: true, refund: 250, cash: 70, terminal: 30 });
  });

  it("shows no refund or review for an unpaid order without coverage", () => {
    const summary = cancelSummary({ ...order, paid: false }, []);
    expect(summary).toEqual({ paid: false, refund: 0, cash: 0, terminal: 0, withTable: 0 });
  });
});
