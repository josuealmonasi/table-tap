import { closeSessionsFor } from "@/lib/table-session";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVerifiedCheckout } from "@/lib/diner-checkout";

/** Only verified provider expiry or outright refusal can free these slots. */
export async function retireSplitAttempt(restaurantId: string, checkoutId: string): Promise<void> {
  const { data, error } = await createAdminClient().rpc("retire_split_attempt_v1", {
    p_restaurant: restaurantId, p_checkout: checkoutId,
  });
  if (error || !["retired", "paid", "gone"].includes(data?.outcome)) {
    throw new Error(`Could not retire split attempt: ${error?.message ?? data?.outcome}`);
  }
}

async function checkoutId(session: Stripe.Checkout.Session): Promise<string> {
  requireVerifiedCheckout(session);
  const { data, error } = await createAdminClient().from("diner_checkouts").select("id, split_id")
    .eq("stripe_session_id", session.id).eq("restaurant_id", session.metadata!.restaurant_id).single();
  if (error || !data || data.split_id !== session.metadata!.split_id) throw new Error("Could not find the split checkout");
  return data.id;
}

export async function settleSplitSlots(session: Stripe.Checkout.Session): Promise<void> {
  const id = await checkoutId(session);
  const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const { data, error } = await createAdminClient().rpc("settle_split_slots_v1", {
    p_restaurant: session.metadata!.restaurant_id, p_checkout: id,
    p_intent: intent, p_charged_cents: session.amount_total,
  });
  // A missing receipt is not success. Stripe must retry until money is recorded
  // as a payment or as a refund owed, including a repeated delivery.
  if (error || !["settled", "duplicate", "refund_due"].includes(data?.outcome)) {
    throw new Error(`Could not settle split slots: ${error?.message ?? data?.outcome}`);
  }
  const { data: split, error: readError } = await createAdminClient().from("bill_splits").select("session_id")
    .eq("id", session.metadata!.split_id).eq("restaurant_id", session.metadata!.restaurant_id).single();
  if (readError) throw new Error("Could not read the paid split sitting");
  if (split?.session_id) await closeSessionsFor([{ session_id: split.session_id }], "paid");
}

export async function abandonSplitSlots(session: Stripe.Checkout.Session): Promise<void> {
  await retireSplitAttempt(session.metadata!.restaurant_id, await checkoutId(session));
}
