import type Stripe from "stripe";

export interface RefundCoverage { id: string; amount_cents: number }

/** Provider success proves the customer's outcome independently of our fee. */
export async function fullyReturnedCharge(client: Stripe, intent: string, account: string): Promise<RefundCoverage[] | null> {
  const payment = await client.paymentIntents.retrieve(intent, { expand: ["latest_charge"] }, { stripeAccount: account });
  const charge = payment.latest_charge as Stripe.Charge | null;
  if (!charge?.amount) return null;
  let returned = 0;
  const coverage: RefundCoverage[] = [];
  for await (const refund of client.refunds.list({ payment_intent: intent, limit: 100 }, { stripeAccount: account })) {
    if (refund.status === "succeeded") { returned += refund.amount; coverage.push({ id: refund.id, amount_cents: refund.amount }); }
  }
  return returned >= charge.amount ? coverage : null;
}

/**
 * What Stripe says about the charge before we ask it for anything (paths
 * audit #7): the refunds the restaurant made by hand, which carry none of our
 * tags, and how much is still refundable. Pending refunds count against that
 * ceiling but are not anybody's coverage until they succeed.
 */
export async function chargeRefundState(
  client: Stripe, intent: string, account: string,
): Promise<{ manual: RefundCoverage[]; refundableCents: number; ids: string[] }> {
  const payment = await client.paymentIntents.retrieve(intent, { expand: ["latest_charge"] }, { stripeAccount: account });
  const charge = payment.latest_charge as Stripe.Charge | null;
  const manual: RefundCoverage[] = [];
  // Every live refund, frozen on the attempt this read decides (bl43 finding 1).
  const ids: string[] = [];
  for await (const refund of client.refunds.list({ payment_intent: intent, limit: 100 }, { stripeAccount: account })) {
    if (isLiveRefund(refund)) ids.push(refund.id);
    if (refund.status === "succeeded" && Object.keys(refund.metadata ?? {}).length === 0) {
      manual.push({ id: refund.id, amount_cents: refund.amount });
    }
  }
  return { manual, refundableCents: refundableOf(charge), ids };
}

/** What Stripe still accepts on the charge: its amount minus every refund, pending ones included. */
export function refundableOf(charge: Stripe.Charge | null): number {
  return Math.max(0, Number(charge?.amount ?? 0) - Number(charge?.amount_refunded ?? 0));
}

/** A refund that has moved, or may still move, the diner's money. */
export function isLiveRefund(refund: Stripe.Refund): boolean {
  return ["succeeded", "pending", "requires_action"].includes(refund.status ?? "");
}

/** Stripe refused a refund for more than the charge has left: nothing was created. */
export function refusedAsTooLarge(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; type?: string; param?: string; message?: string };
  return e.code === "amount_too_large"
    || (e.type === "StripeInvalidRequestError" && e.param === "amount" && /greater than (the )?unrefunded/i.test(e.message ?? ""));
}
