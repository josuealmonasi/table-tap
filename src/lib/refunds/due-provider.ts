import type Stripe from "stripe";

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

/**
 * Our share of the fee on a charge the restaurant refunded by hand.
 *
 * A refund made in the restaurant's own Stripe dashboard leaves our fee where
 * it is. This returns the part of it that belongs to the money given back —
 * all of it when the whole charge was paid twice.
 */
export async function returnOurFee(
  client: Stripe,
  paymentIntent: string,
  stripeAccount: string,
  refundedCents: number,
  id: string,
  prepare: (feeId: string, amount: number) => Promise<{ fee_id: string; amount: number }>,
): Promise<boolean> {
  const intent = await client.paymentIntents.retrieve(
    paymentIntent,
    { expand: ["latest_charge"] },
    { stripeAccount },
  );
  const charge = intent.latest_charge as Stripe.Charge | null;
  const feeId =
    typeof charge?.application_fee === "string" ? charge.application_fee : charge?.application_fee?.id;
  if (!charge?.amount) return false;
  let confirmed = 0;
  for await (const refund of client.refunds.list({ payment_intent: paymentIntent, limit: 100 }, { stripeAccount })) {
    if (refund.status === "succeeded") confirmed += refund.amount;
  }
  if (confirmed < refundedCents) return false;
  if (!feeId) return true;
  const fee = await client.applicationFees.retrieve(feeId);
  // Stripe may already have returned part of this fee with a customer refund.
  // Work toward the cumulative target, never return the same share again.
  const share = Math.round((fee.amount * Math.min(confirmed, charge.amount)) / charge.amount);
  const back = share - fee.amount_refunded;
  if (back <= 0) return true;
  const request = await prepare(feeId, back);
  // Keys expire at Stripe. A lost response still has durable provider evidence.
  for await (const made of client.applicationFees.listRefunds(request.fee_id, { limit: 100 })) {
    if (made.metadata?.refund_due === id) return false;
  }
  if (request.fee_id !== feeId || request.amount > back) return false;
  await client.applicationFees.createRefund(
    request.fee_id,
    { amount: request.amount, metadata: { refund_due: id } },
    { idempotencyKey: `refund-due-fee-${id}` },
  );
  const returned = await client.applicationFees.retrieve(feeId);
  return returned.amount_refunded >= share;
}

/** Provider success proves the customer's outcome independently of our fee. */
export async function fullyReturnedCharge(client: Stripe, intent: string, account: string): Promise<string | null> {
  const payment = await client.paymentIntents.retrieve(intent, { expand: ["latest_charge"] }, { stripeAccount: account });
  const charge = payment.latest_charge as Stripe.Charge | null;
  if (!charge?.amount) return null;
  let returned = 0;
  let id: string | null = null;
  for await (const refund of client.refunds.list({ payment_intent: intent, limit: 100 }, { stripeAccount: account })) {
    if (refund.status === "succeeded") { returned += refund.amount; id ??= refund.id; }
  }
  return returned >= charge.amount ? id : null;
}
