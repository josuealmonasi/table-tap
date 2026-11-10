import type Stripe from "stripe";
import type { FeePayment } from "./fees";

/** MXN pricing cannot estimate a dollar fee; use the original connected charge. */
export async function withProcessingFees(payments: FeePayment[]): Promise<FeePayment[]> {
  const groups = new Map<string, FeePayment[]>();
  for (const payment of payments) {
    if (!payment.stripe_payment_intent || !payment.currency || payment.currency === "MXN") continue;
    if (!payment.stripe_account_id) throw new Error("The processing fee has no connected account evidence");
    const key = `${payment.stripe_account_id}:${payment.stripe_payment_intent}`;
    groups.set(key, [...(groups.get(key) ?? []), payment]);
  }
  if (!groups.size) return payments;
  const { stripe } = await import("@/lib/stripe");
  const fees = new Map<FeePayment, number>();
  for (const group of groups.values()) {
    const first = group[0];
    const intent = await stripe.paymentIntents.retrieve(first.stripe_payment_intent!,
      { expand: ["latest_charge.balance_transaction"] }, { stripeAccount: first.stripe_account_id! });
    const charge = intent.latest_charge;
    if (!charge || typeof charge === "string" || !charge.paid || charge.currency.toUpperCase() !== first.currency ||
      group.some(p => p.currency !== first.currency)) throw new Error("The processing fee has no matching charge evidence");
    const balance = charge.balance_transaction;
    if (!balance || typeof balance === "string") throw new Error("The processing fee is not available yet");
    const total = processingFee(balance, first.currency!);
    const amount = group.reduce((sum, p) => sum + Number(p.amount), 0);
    if (!(amount > 0)) throw new Error("The processing fee has no payment amount");
    // Allocated rows share one charge. Divide its fee once, just as its fixed fee was counted once.
    for (const payment of group) fees.set(payment, total * Number(payment.amount) / amount);
  }
  return payments.map(payment => fees.has(payment) ? { ...payment, processing_fee: fees.get(payment)! } : payment);
}

/** Balance fees use settlement currency; the saved exchange rate returns charge units. */
function processingFee(balance: Stripe.BalanceTransaction, currency: string): number {
  const appFee = balance.fee_details.filter(fee => fee.type === "application_fee").reduce((sum, fee) => sum + fee.amount, 0);
  const fee = (balance.fee - appFee) / 100;
  const fx = balance.currency.toUpperCase() === currency ? 1 : balance.exchange_rate;
  if (!Number.isFinite(fee) || fee < 0 || !fx || !Number.isFinite(fx) || fx <= 0) {
    throw new Error("The processing fee has no matching currency evidence");
  }
  return fee / fx;
}
