import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export async function syncReturnedFee(client: Stripe, restaurantId: string, intentId: string, account: string): Promise<void> {
  const intent = await client.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }, { stripeAccount: account });
  const charge = intent.latest_charge as Stripe.Charge | null;
  const feeId = typeof charge?.application_fee === "string" ? charge.application_fee : charge?.application_fee?.id;
  const fee = feeId ? await client.applicationFees.retrieve(feeId) : null;
  const { error } = await createAdminClient().rpc("sync_refunded_platform_fee", {
    p_restaurant: restaurantId, p_intent: intentId, p_cents: fee?.amount_refunded ?? 0,
  });
  if (error) throw new Error(`Could not reconcile the returned platform fee: ${error.message}`);
}
