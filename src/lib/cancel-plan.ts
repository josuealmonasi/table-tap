// ============================================================================
// What cancelling a paid order gives back, and who has to do the giving.
//
// One function, read by the route that cancels and by the dialog that asks
// first, so the screen cannot promise one thing while the server does another.
// That is how this went wrong: the dialog promised "the customer will be
// refunded" for every paid card order, and the route could only refund one
// whose payment intent was stamped on the order itself. A POS card sale, a
// table settled by card at its terminal, a table's bill paid online in one go
// — all were answered "payment still settling, try again", for ever.
//
// The ledger decides, not `pay_method`: each payment says how it arrived.
//   - through Stripe (it has a payment intent) → refunded through Stripe, for
//     that payment's amount, so one order of a table's bill gets back its own
//     share and not the whole charge
//   - taken by someone on the staff with no intent → cash from their drawer,
//     or a charge on the restaurant's own terminal. The app can move neither,
//     so a person gives it back, and it leaves that person's line in the corte
//   - no payment of its own → paid as part of its table (a divided bill, a
//     table collected in parts). No one card or drawer is its, so a person
//     gives back its total
// ============================================================================
import { round2 } from "@/lib/money";

export interface CancelOrder {
  paid: boolean;
  pay_method: string | null;
  total: number | string;
  stripe_payment_intent: string | null;
}

export interface CancelPayment {
  amount: number | string;
  method: string;
  actor_email: string | null;
  stripe_payment_intent: string | null;
}

/** Given back to the diner's card by Stripe. */
export interface StripeRefund {
  paymentIntent: string;
  amount: number;
  collector: string | null;
}

/** Given back by a person: notes from a drawer, or a void on a card terminal. */
export interface HandBack {
  amount: number;
  method: "cash" | "card";
  /** Whose drawer or terminal it leaves. Null when it was paid with the table. */
  collector: string | null;
}

export interface CancelPlan {
  refunds: StripeRefund[];
  handBack: HandBack[];
}

const asMethod = (m: string | null): "cash" | "card" => (m === "cash" ? "cash" : "card");

export function cancelPlan(order: CancelOrder, payments: CancelPayment[]): CancelPlan {
  const plan: CancelPlan = { refunds: [], handBack: [] };
  if (!order.paid) return plan;

  for (const p of payments) {
    const amount = round2(Number(p.amount));
    // Recorded before the ledger kept the intent, on an order that has one.
    const intent = p.stripe_payment_intent ?? (p.actor_email ? null : order.stripe_payment_intent);
    if (intent) plan.refunds.push({ paymentIntent: intent, amount, collector: p.actor_email });
    else plan.handBack.push({ amount, method: asMethod(p.method), collector: p.actor_email });
  }
  if (payments.length > 0) return plan;

  const total = round2(Number(order.total));
  // Paid online before there was a ledger to record it in.
  if (order.stripe_payment_intent) {
    plan.refunds.push({ paymentIntent: order.stripe_payment_intent, amount: total, collector: null });
  } else {
    plan.handBack.push({ amount: total, method: asMethod(order.pay_method), collector: null });
  }
  return plan;
}

/** What the dialog needs to word the offer: sums, never whose line. */
export interface CancelSummary {
  paid: boolean;
  refund: number;
  cash: number;
  terminal: number;
  withTable: number;
}

export function summarise(order: CancelOrder, plan: CancelPlan): CancelSummary {
  const sum = (xs: { amount: number }[]) => round2(xs.reduce((s, x) => s + x.amount, 0));
  const byPerson = plan.handBack.filter(h => h.collector);
  return {
    paid: order.paid,
    refund: sum(plan.refunds),
    cash: sum(byPerson.filter(h => h.method === "cash")),
    terminal: sum(byPerson.filter(h => h.method === "card")),
    withTable: sum(plan.handBack.filter(h => !h.collector)),
  };
}
