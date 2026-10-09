import { stripe } from "@/lib/stripe";
import { FOUNDING_SLOTS } from "@/lib/founding";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPlanName, subscriptionOutcome } from "@/lib/billing";
import type Stripe from "stripe";
import type { PlanName } from "@/lib/plan";

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

  const db = createAdminClient();
  // Events can arrive in any order. Read Stripe's current object after the
  // local revision, and only store it while that revision still matches.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: current, error: readError } = await db.from("restaurants")
      .select("stripe_subscription_id, subscription_sync_revision")
      .eq("id", restaurantId).maybeSingle();
    if (readError) throw new Error(`Subscription lookup failed: ${readError.message}`);
    if (!current) return;
    const latest = await stripe.subscriptions.retrieve(sub.id);
    if (current.stripe_subscription_id && current.stripe_subscription_id !== latest.id) {
      const active = await stripe.subscriptions.retrieve(current.stripe_subscription_id);
      // A late cancellation from the previous subscription must not replace
      // the newer contract. Equal creation seconds keep the active contract.
      if (active.created > latest.created ||
          (active.created === latest.created && !["canceled", "incomplete_expired"].includes(active.status))) return;
    }
    const latestPlan = readPlanName(latest.metadata?.plan);
    if (!latestPlan || latest.metadata?.restaurant_id !== restaurantId) {
      throw new Error(`Subscription ${latest.id} has inconsistent metadata`);
    }
    await claimFounder(db, latest, latestPlan);
    const outcome = subscriptionOutcome(latest.status, latestPlan);
    const charged = latest.items?.data?.[0]?.price?.unit_amount;
    const { data: updated, error } = await db.from("restaurants").update({
      plan: outcome.plan,
      plan_status: outcome.status,
      stripe_subscription_id: latest.id,
      subscription_sync_revision: current.subscription_sync_revision + 1,
      ...(typeof charged === "number" ? { subscribed_price: charged / 100 } : {}),
      trial_ends_at: null,
    }).eq("id", restaurantId)
      .eq("subscription_sync_revision", current.subscription_sync_revision).select("id");
    if (error) throw new Error(`Subscription update failed: ${error.message}`);
    if (updated?.length) return;
  }
  throw new Error(`Subscription ${sub.id} changed during synchronization; retry required`);
}

async function claimFounder(
  db: ReturnType<typeof createAdminClient>, sub: Stripe.Subscription, plan: PlanName,
): Promise<void> {
  const restaurantId = sub.metadata.restaurant_id;
  const outcome = subscriptionOutcome(sub.status, plan);
  // The founding place is taken on subscribing, not on signing up: if signup
  // counted, free registrations would eat the places without anyone ever
  // having paid. If they are already a founder they keep their number.
  if (outcome.status === "active" || outcome.status === "trialing") {
    const { data: number, error: claimError } = await db.rpc("claim_founding_price", {
      p_restaurant: restaurantId,
      p_limit: FOUNDING_SLOTS,
    });
    if (claimError) throw new Error(`Founding claim failed: ${claimError.message}`);

    // Two restaurants subscribing in the same second can both see the founding
    // price with room for only one. Whoever was already charged that price is
    // honoured: charging a founder's price and not making them one would be
    // keeping their money under a promise we never meant to keep.
    if (number === null && (await paidFoundingPrice(db, sub, plan))) {
      const { error } = await db.rpc("claim_founding_price", {
        p_restaurant: restaurantId,
        p_limit: FOUNDING_SLOTS + 25,
      });
      if (error) throw new Error(`Founding claim failed: ${error.message}`);
    }
  }
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
  const { data, error } = await db
    .from("plan_limits")
    .select("monthly_price")
    .eq("plan", plan)
    .maybeSingle();
  if (error) throw new Error(`Founding price lookup failed: ${error.message}`);
  const founding = (data as { monthly_price: number } | null)?.monthly_price;
  return typeof founding === "number" && Math.round(founding * 100) === charged;
}
