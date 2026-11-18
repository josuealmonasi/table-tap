import type { createAdminClient } from "@/lib/supabase/admin";
import { BillingError } from "@/lib/billing-operation";

/** The assignment an emailed pay link was sent for: its tier and its id. */
export interface AssignedTier {
  plan: string;
  /** `restaurants.tier_assignment_id` when the email was sent. */
  id: string;
}

/**
 * Checked inside the billing lock, right before Checkout opens. The pay link
 * used to check the restaurant before taking the lock; an owner who subscribed
 * to something else in between had that live subscription silently moved to
 * the emailed tier and invoiced at once (review 2026-11-17, finding 1). The
 * link is bound to its assignment by id (finding 7: the pay-by day alone also
 * matched a replaced assignment recreated for the same tier and day): a later
 * assignment, a free move, a paid one or an expired one is a different link.
 */
export async function assertStillAssigned(
  db: ReturnType<typeof createAdminClient>, restaurantId: string, assigned: AssignedTier, liveSubscriptions: number,
): Promise<void> {
  if (liveSubscriptions > 0) throw new BillingError("apiErr.tierLinkStale");
  const { data, error } = await db.from("restaurants")
    .select("plan, plan_status, trial_ends_at, stripe_subscription_id, tier_assignment_id").eq("id", restaurantId).maybeSingle();
  if (error) throw new Error(`Assigned tier lookup failed: ${error.message}`);
  const ends = data?.trial_ends_at ? new Date(data.trial_ends_at as string) : null;
  const current = !!data && data.plan === assigned.plan && data.plan_status === "trialing" && !data.stripe_subscription_id
    && !!ends && ends.getTime() > Date.now() && data.tier_assignment_id === assigned.id;
  if (!current) throw new BillingError("apiErr.tierLinkStale");
}
