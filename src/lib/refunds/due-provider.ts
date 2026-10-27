import type Stripe from "stripe";

export interface RefundCoverage { id: string; amount_cents: number }

/** A refund Stripe already made for this row, found by the tag it carries. */
export async function refundMadeFor(
  client: Stripe,
  paymentIntent: string,
  stripeAccount: string,
  id: string,
  attemptId: string,
  attemptNo: number,
): Promise<Stripe.Refund | null> {
  for await (const made of client.refunds.list({ payment_intent: paymentIntent, limit: 100 }, { stripeAccount })) {
    if (made.metadata?.refund_due === id && (made.metadata?.refund_due_attempt === attemptId
      || (attemptNo === 1 && !made.metadata?.refund_due_attempt))) return made;
  }
  return null;
}

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
