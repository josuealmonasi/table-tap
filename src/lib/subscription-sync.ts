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
    // A finished subscription the restaurant no longer has is history, not a
    // plan. Stripe re-delivers a cancellation for days; a platform admin who
    // moved the restaurant in between (which unlinks the subscription) must
    // not see that move quietly reset to the free plan.
    if (!current.stripe_subscription_id && ["canceled", "incomplete_expired"].includes(latest.status)) return;
    if (current.stripe_subscription_id && current.stripe_subscription_id !== latest.id) {
      const active = await stripe.subscriptions.retrieve(current.stripe_subscription_id);
      // A late cancellation from the previous subscription must not replace
      // the newer contract. Equal creation seconds keep the active contract;
      // two live contracts need review rather than silently forgetting one.
      const activeFinished = ["canceled", "incomplete_expired"].includes(active.status);
      if (!activeFinished) {
        if (["canceled", "incomplete_expired"].includes(latest.status)) return;
        throw new Error(`Restaurant ${restaurantId} already has a live subscription ${active.id}; reconcile ${latest.id}`);
      }
      if (active.created > latest.created) return;
    }
    const latestPlan = readPlanName(latest.metadata?.plan);
    if (!latestPlan || latest.metadata?.restaurant_id !== restaurantId) {
      throw new Error(`Subscription ${latest.id} has inconsistent metadata`);
    }
    const outcome = subscriptionOutcome(latest.status, latestPlan);
    // Do not link an unpaid first contract: getPlan must still be able to
    // expire the local trial. Customer lookup in checkout finds it for retries.
    const pending = !outcome || (current.stripe_subscription_id !== latest.id && !["active", "trialing"].includes(latest.status));
    if (!pending) await claimFounder(db, latest, latestPlan);
    const item = latest.items?.data?.[0];
    const ended = ["canceled", "incomplete_expired"].includes(latest.status);
    const endsAt = latest.cancel_at ?? (latest.cancel_at_period_end ? item?.current_period_end : null);
    const charged = item?.price?.unit_amount;
    const { data: updated, error } = await db.from("restaurants").update({
      subscription_sync_revision: current.subscription_sync_revision + 1,
      ...(!pending && outcome ? {
        plan: outcome.plan,
        plan_status: outcome.status,
        stripe_subscription_id: latest.id,
        subscribed_price: !ended && typeof charged === "number" ? charged / 100 : null,
        plan_ends_at: !ended && endsAt ? new Date(endsAt * 1000).toISOString() : null,
        trial_ends_at: null,
      } : {}),
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
  if (outcome?.status === "active") {
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
