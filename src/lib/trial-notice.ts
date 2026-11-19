import { trialDaysLeft } from "@/lib/plan";

export interface TrialNotice {
  plan: string; days: number; endsAt: string; urgent: boolean;
  /** Set when this is not a free trial but a tier the admin assigned with a date to pay by. */
  assignment: string | null;
}

/** Days left from which the banner turns into a warning. */
export const TRIAL_URGENT_DAYS = 7;

/**
 * The free trial an owner is in, if any: trialing, no card on file (nothing
 * will be charged), and not over yet. When it ends the restaurant falls back
 * to Carta (`effective_restaurant_plan`). Null otherwise.
 */
export function trialNotice(
  r: { plan?: string | null; plan_status?: string | null; trial_ends_at?: string | null; stripe_subscription_id?: string | null;
    tier_assignment_id?: string | null },
  now: Date = new Date(),
): TrialNotice | null {
  if (r.plan_status !== "trialing" || r.stripe_subscription_id || !r.trial_ends_at || !r.plan) return null;
  const days = trialDaysLeft(r.trial_ends_at, now);
  if (days <= 0) return null;
  // The admin's pay-by window is stored as `trialing` too, but it is not free:
  // the owner owes the payment (the trial email skips it for the same reason).
  return { plan: r.plan, days, endsAt: r.trial_ends_at, urgent: days <= TRIAL_URGENT_DAYS, assignment: r.tier_assignment_id ?? null };
}
