import { FOUNDING_SLOTS } from "@/lib/founding";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPlanName, subscriptionOutcome } from "@/lib/billing";
import type Stripe from "stripe";

/**
 * What a subscription event means for the restaurant paying it.
 *
 * This is the PLATFORM side of the money. A restaurant's subscription is
 * charged on our own Stripe account, so its events arrive on our own endpoint —
 * unlike a diner's food, which is a direct charge on the restaurant's account
 * and arrives on the connected one. Two accounts, two streams, two routes.
 *
 * SERVER-ONLY: every write is made with the secret key.
 */

/**
 * Writes a subscription's state onto the restaurant that owns it.
 *
 * The metadata set at checkout is the only thing trusted here: a webhook is
 * unauthenticated apart from its signature, so which restaurant and which tier
 * must come from what we ourselves stamped on the subscription.
 *
 * `deleted` events arrive with status `canceled`, which the mapping already
 * turns into a free customer rather than a locked one.
 */
export async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const restaurantId = sub.metadata?.restaurant_id;
  const plan = readPlanName(sub.metadata?.plan);
  if (!restaurantId || !plan) {
    console.error("subscription without our metadata", sub.id);
    return;
  }

  const outcome = subscriptionOutcome(sub.status, plan);
  const db = createAdminClient();

  // The founding place is taken on subscribing, not on signing up: if signup
  // counted, free registrations would eat the places without anyone ever
  // having paid. If they are already a founder they keep their number.
  if (outcome.status === "active" || outcome.status === "trialing") {
    const { data: number, error: claimError } = await db.rpc("claim_founding_price", {
      p_restaurant: restaurantId,
      p_limit: FOUNDING_SLOTS,
    });
    if (claimError) console.error("founding claim failed", restaurantId, claimError.message);

    // Two restaurants subscribing in the same second can both see the founding
    // price with room for only one. Whoever was already charged that price is
    // honoured: charging a founder's price and not making them one would be
    // keeping their money under a promise we never meant to keep.
    if (number === null && (await paidFoundingPrice(db, sub, plan))) {
      await db.rpc("claim_founding_price", {
        p_restaurant: restaurantId,
        p_limit: FOUNDING_SLOTS + 25,
      });
    }
  }

  // What Stripe actually charges them, so the Plan screen does not show the
  // catalogue price to somebody who subscribed at another.
  const charged = sub.items?.data?.[0]?.price?.unit_amount;

  const { error } = await db
    .from("restaurants")
    .update({
      plan: outcome.plan,
      plan_status: outcome.status,
      stripe_subscription_id: sub.id,
      ...(typeof charged === "number" ? { subscribed_price: charged / 100 } : {}),
      // The trial is Stripe's to run once there is a subscription; ours only
      // covers the stretch before one exists.
      trial_ends_at: null,
    })
    .eq("id", restaurantId);

  if (error) console.error("subscription update failed", sub.id, error.message);
}

/**
 * Was this subscription charged the founding price?
 *
 * Compared against the plan's base price, which is exactly the one only
 * founders pay once the places have run out.
 */
async function paidFoundingPrice(
  db: ReturnType<typeof createAdminClient>,
  sub: Stripe.Subscription,
  plan: string,
): Promise<boolean> {
  const charged = sub.items?.data?.[0]?.price?.unit_amount;
  if (typeof charged !== "number") return false;
  const { data } = await db
    .from("plan_limits")
    .select("monthly_price")
    .eq("plan", plan)
    .maybeSingle();
  const founding = (data as { monthly_price: number } | null)?.monthly_price;
  return typeof founding === "number" && Math.round(founding * 100) === charged;
}
