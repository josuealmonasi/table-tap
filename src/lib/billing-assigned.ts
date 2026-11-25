import type { createAdminClient } from "@/lib/supabase/admin";
import { BillingError } from "@/lib/billing-operation";

interface CheckoutAssignment {
  id: string;
  payBy: number;
}

// The billing lock keeps the emailed link on its original assignment. Buying
// that same tier from the Plan screen must use the assignment's deadline too.
export async function checkoutAssignment(
  db: ReturnType<typeof createAdminClient>, restaurantId: string, plan: string, liveSubscriptions: number,
  requestedId?: string,
): Promise<CheckoutAssignment | null> {
  if (liveSubscriptions > 0) {
    if (requestedId) throw new BillingError("apiErr.tierLinkStale");
    return null;
  }
  const { data, error } = await db.from("restaurants")
    .select("plan, plan_status, trial_ends_at, stripe_subscription_id, tier_assignment_id").eq("id", restaurantId).maybeSingle();
  if (error) throw new Error(`Assigned tier lookup failed: ${error.message}`);
  const currentTrial = data?.plan === plan && data.plan_status === "trialing" && !data.stripe_subscription_id;
  const id = currentTrial && typeof data?.tier_assignment_id === "string" ? data.tier_assignment_id : null;
  if (!requestedId && !id) return null;
  const trialEnds = Date.parse(data?.trial_ends_at ?? "");
  if (!id || (requestedId && requestedId !== id) || !Number.isFinite(trialEnds) || trialEnds <= Date.now()) {
    throw new BillingError("apiErr.tierLinkStale");
  }
  return { id, payBy: Math.floor(trialEnds / 1000) };
}

export function assignmentCheckoutExpiry(payBy: number): number | null {
  const now = Date.now() / 1000;
  // Stripe accepts an expiry from 30 minutes to 24 hours after creation.
  if (payBy - now < 30 * 60) return null;
  return Math.min(payBy, Math.floor(now + 24 * 60 * 60));
}
