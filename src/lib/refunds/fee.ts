import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export async function syncReturnedFee(client: Stripe, restaurantId: string, intentId: string, account: string): Promise<void> {
  const db = createAdminClient();
  // Read before Stripe: a refund failing while we read moves the epoch on,
  // and this snapshot is then refused instead of trusted (audit P, finding 2).
  const { data: epoch, error: epochError } = await db.rpc("refund_fee_epoch", { p_restaurant: restaurantId, p_intent: intentId });
  if (epochError || typeof epoch !== "number") throw new Error(`Could not read the fee verification epoch: ${epochError?.message ?? "no epoch"}`);
  const intent = await client.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }, { stripeAccount: account });
  const charge = intent.latest_charge as Stripe.Charge | null;
  if (!charge?.amount) throw new Error("Could not verify the original charge for the returned fee");
  const feeId = typeof charge?.application_fee === "string" ? charge.application_fee : charge?.application_fee?.id;
  const fee = feeId ? await client.applicationFees.retrieve(feeId) : null;
  let refunded = 0;
  const refundIds: string[] = [];
  if (fee) for await (const refund of client.refunds.list({ payment_intent: intentId, limit: 100 }, { stripeAccount: account })) {
    if (refund.status === "succeeded") { refunded += refund.amount; refundIds.push(refund.id); }
  }
  const target = fee ? Math.round(fee.amount * Math.min(refunded, charge.amount) / charge.amount) : 0;
  const { data: current, error } = await db.rpc("verify_refunded_platform_fee_v2", {
    p_restaurant: restaurantId, p_intent: intentId, p_cents: fee?.amount_refunded ?? 0,
    p_target: target, p_refunds: fee ? refundIds : null, p_epoch: epoch,
  });
  if (error) throw new Error(`Could not reconcile the returned platform fee: ${error.message}`);
  // Stays pending; the next recovery reads Stripe again under the new epoch.
  if (current !== true) throw new Error("The returned fee changed while it was being verified");
}
