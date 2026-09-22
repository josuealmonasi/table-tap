import { describe, expect, it } from "vitest";
import { cancelPlan, summarise, type CancelOrder, type CancelPayment } from "@/lib/cancel-plan";

const order = (extra: Partial<CancelOrder> = {}): CancelOrder => ({
  paid: true, pay_method: "card", total: 80, stripe_payment_intent: null, ...extra,
});
const pay = (extra: Partial<CancelPayment> = {}): CancelPayment => ({
  amount: 80, method: "card", actor_email: null, stripe_payment_intent: null, ...extra,
});

describe("what a cancel gives back", () => {
  it("gives nothing back for an order nobody paid", () => {
    expect(cancelPlan(order({ paid: false }), [])).toEqual({ refunds: [], handBack: [] });
  });

  it("refunds a single online order through Stripe", () => {
    const plan = cancelPlan(order({ stripe_payment_intent: "pi_1" }), [pay({ stripe_payment_intent: "pi_1" })]);
    expect(plan).toEqual({ refunds: [{ paymentIntent: "pi_1", amount: 80, collector: null }], handBack: [] });
  });

  // The bug: a table's bill paid online in one go stamps the intent on each
  // order's payment, never on the order. The route looked only at the order
  // and answered "still settling" for ever.
  it("refunds one order of a table's online bill for its own share only", () => {
    const plan = cancelPlan(order({ total: 30 }), [pay({ amount: 30, stripe_payment_intent: "pi_table" })]);
    expect(plan.refunds).toEqual([{ paymentIntent: "pi_table", amount: 30, collector: null }]);
    expect(plan.handBack).toEqual([]);
  });

  it("leaves a POS card sale to the terminal that took it, against the cashier", () => {
    const plan = cancelPlan(order(), [pay({ actor_email: "cashier@x" })]);
    expect(plan).toEqual({ refunds: [], handBack: [{ amount: 80, method: "card", collector: "cashier@x" }] });
  });

  it("leaves cash to the drawer that took it", () => {
    const plan = cancelPlan(order({ pay_method: "cash" }), [pay({ method: "cash", actor_email: "waiter@x" })]);
    expect(plan.handBack).toEqual([{ amount: 80, method: "cash", collector: "waiter@x" }]);
  });

  it("never sends a staff-taken payment to Stripe on the strength of the order's intent", () => {
    // An intent on the order and a card payment somebody took by hand: the
    // one they took is not Stripe's to give back.
    const plan = cancelPlan(order({ stripe_payment_intent: "pi_1" }), [pay({ actor_email: "cashier@x" })]);
    expect(plan.refunds).toEqual([]);
    expect(plan.handBack).toEqual([{ amount: 80, method: "card", collector: "cashier@x" }]);
  });

  it("uses the order's intent for an online payment recorded without one", () => {
    const plan = cancelPlan(order({ stripe_payment_intent: "pi_old" }), [pay()]);
    expect(plan.refunds).toEqual([{ paymentIntent: "pi_old", amount: 80, collector: null }]);
  });

  it("refunds an order paid online before there was a ledger", () => {
    const plan = cancelPlan(order({ stripe_payment_intent: "pi_old" }), []);
    expect(plan.refunds).toEqual([{ paymentIntent: "pi_old", amount: 80, collector: null }]);
  });

  it("names no drawer for an order paid only through its table", () => {
    expect(cancelPlan(order(), []).handBack).toEqual([{ amount: 80, method: "card", collector: null }]);
    expect(cancelPlan(order({ pay_method: "cash" }), []).handBack)
      .toEqual([{ amount: 80, method: "cash", collector: null }]);
  });

  it("folds a wallet into a card, the way the ledger does", () => {
    expect(cancelPlan(order({ pay_method: "apple" }), []).handBack[0].method).toBe("card");
  });

  it("gives back every payment an order has, each its own way", () => {
    const plan = cancelPlan(order({ total: 100 }), [
      pay({ amount: 60, stripe_payment_intent: "pi_1" }),
      pay({ amount: 40, method: "cash", actor_email: "waiter@x" }),
    ]);
    expect(plan.refunds.map(r => r.amount)).toEqual([60]);
    expect(plan.handBack.map(h => h.amount)).toEqual([40]);
  });

  it("reads amounts that arrive from the database as strings", () => {
    const plan = cancelPlan(order({ total: "10.50" }), [pay({ amount: "10.50", stripe_payment_intent: "pi_1" })]);
    expect(plan.refunds[0].amount).toBe(10.5);
  });
});

describe("what the dialog is told", () => {
  it("sorts the handbacks by who has to do them", () => {
    const o = order({ total: 100 });
    const s = summarise(o, cancelPlan(o, [
      pay({ amount: 10, stripe_payment_intent: "pi_1" }),
      pay({ amount: 20, method: "cash", actor_email: "w@x" }),
      pay({ amount: 30, actor_email: "c@x" }),
    ]));
    expect(s).toEqual({ paid: true, refund: 10, cash: 20, terminal: 30, withTable: 0 });
  });

  it("calls money with no drawer a share of the table's bill", () => {
    const o = order();
    expect(summarise(o, cancelPlan(o, [])).withTable).toBe(80);
  });

  it("names nobody to the dialog", () => {
    const o = order();
    const s = summarise(o, cancelPlan(o, [pay({ actor_email: "cashier@x" })]));
    expect(JSON.stringify(s)).not.toContain("cashier@x");
  });
});
