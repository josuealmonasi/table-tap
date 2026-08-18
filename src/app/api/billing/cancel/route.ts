import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingOwner } from "@/lib/api-guard";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const { resume } = (await req.json().catch(() => ({}))) as { resume?: boolean };

  const db = createAdminClient();
  const { data } = await db
    .from("restaurants")
    .select("stripe_subscription_id")
    .eq("id", actor.restaurantId)
    .single();

  const subscriptionId = data?.stripe_subscription_id as string | null;
  if (!subscriptionId) return await apiError("apiErr.noBilling", 400);

  const sub = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: !resume,
  });

  // Remembered so the screen can say when it ends without asking Stripe again.
  await db
    .from("restaurants")
    .update({
      plan_ends_at: sub.cancel_at_period_end
        ? new Date(sub.items.data[0].current_period_end * 1000).toISOString()
        : null,
    })
    .eq("id", actor.restaurantId);

  return NextResponse.json({ ok: true, endsAt: sub.cancel_at_period_end });
}
