// ============================================================================
// What cancelling a paid order gives back, worded before the manager confirms.
//
// The preview must classify each retained payment allocation exactly like
// `prepare_order_refund`, the writer that records the refund obligations:
//   - another currency, or Stripe money that is not exact or has no verified
//     provider account -> review (nothing is sent to Stripe automatically)
//   - Stripe with exact coverage and a provider account -> Stripe refund
//   - no intent -> cash from a drawer, or a return on the restaurant's terminal
//   - paid money the allocations do not cover -> review
// ============================================================================
import { round2 } from "@/lib/money";

export interface CancelPayment {
  amount: number | string;
  currency: string | null;
  method: string;
  stripe_payment_intent: string | null;
  stripe_account_id: string | null;
  allocation_quality: string;
}

/** What the dialog needs to word the offer: sums, never whose line. */
export interface CancelSummary {
  paid: boolean;
  pending?: boolean;
  refund: number;
  cash: number;
  terminal: number;
  withTable: number;
  review?: { amount: number; currency: string }[];
}

export function cancelSummary(order: { paid: boolean; currency: string; total: number }, payments: CancelPayment[]): CancelSummary {
  const summary: CancelSummary = { paid: order.paid || payments.length > 0, refund: 0, cash: 0, terminal: 0, withTable: 0 };
  const review = new Map<string, number>();
  const addReview = (currency: string, amount: number) => review.set(currency, round2((review.get(currency) ?? 0) + amount));
  let covered = 0;
  for (const payment of payments) {
    const amount = Number(payment.amount);
    covered += amount;
    // Match prepare_order_refund: only exact coverage tied to a verified
    // provider account can be refunded automatically.
    const hasIntent = payment.stripe_payment_intent !== null;
    if (payment.currency !== order.currency ||
        (hasIntent && (payment.allocation_quality !== "exact" || payment.stripe_account_id === null))) {
      addReview(payment.currency ?? order.currency, amount);
    } else if (hasIntent) {
      summary.refund = round2(summary.refund + amount);
    } else {
      const source = payment.method === "cash" ? "cash" : "terminal";
      summary[source] = round2(summary[source] + amount);
    }
  }
  const remaining = round2(Number(order.total) - covered);
  if (order.paid && remaining > 0) addReview(order.currency, remaining);
  if (review.size) summary.review = [...review].map(([currency, amount]) => ({ currency, amount }));
  return summary;
}
