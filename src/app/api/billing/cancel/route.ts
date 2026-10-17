import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingOwner } from "@/lib/api-guard";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { applySubscription } from "@/lib/subscription-sync";
import { BillingError, billingFailure, withRestaurantBilling } from "@/lib/billing-operation";

export const runtime = "nodejs";

/**
 * POST /api/billing/cancel — end the subscription, or change your mind.
 *
 * In our own screen rather than behind a link to Stripe. Cancelling is the one
 * thing a subscription must never make somebody hunt for: a plan that is hard
 * to leave is a plan people are afraid to start, and an owner who cannot find
 * the button emails us instead, which is worse for both of us.
 *
 * It cancels at the end of the period they have already paid for — they keep
 * what they bought until it runs out — and it is reversible right up to that
 * moment. The webhook is still what writes the plan down when it actually
 * ends; this only sets the intention.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{ resume?: boolean }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { resume } = body;

  const db = createAdminClient();
  try {
    return await withRestaurantBilling(db, actor.restaurantId, async operation => {
      const { data, error } = await db.from("restaurants").select("stripe_subscription_id")
        .eq("id", actor.restaurantId).single();
      if (error) throw new Error(`Billing lookup failed: ${error.message}`);
      const subscriptionId = data?.stripe_subscription_id as string | null;
      if (!subscriptionId) throw new BillingError("apiErr.noBilling", 400);
      const sub = await operation.write(() => stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: !resume,
      }, { timeout: 30000, maxNetworkRetries: 1, idempotencyKey: `billing-cancel-${operation.token}` }));
      // Remembered so the screen can say when it ends without asking Stripe again.
      // Use the same current-state read and revision guard as webhooks. A
      // delayed response must not put back a date the portal just cleared.
      await applySubscription(sub);
      return NextResponse.json({ ok: true, endsAt: sub.cancel_at_period_end });
    });
  } catch (err) {
    return await billingFailure(err);
  }
}
