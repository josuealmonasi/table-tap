import { trialDaysLeft } from "@/lib/plan";

export interface TrialNotice { plan: string; days: number; endsAt: string; urgent: boolean }

/** Days left from which the banner turns into a warning. */
export const TRIAL_URGENT_DAYS = 7;

/**
 * The free trial an owner is in, if any: trialing, no card on file (nothing
 * will be charged), and not over yet. When it ends the restaurant falls back
 * to Carta (`effective_restaurant_plan`). Null otherwise.
 */
export function trialNotice(
  r: { plan?: string | null; plan_status?: string | null; trial_ends_at?: string | null; stripe_subscription_id?: string | null },
  now: Date = new Date(),
): TrialNotice | null {
  if (r.plan_status !== "trialing" || r.stripe_subscription_id || !r.trial_ends_at || !r.plan) return null;
  const days = trialDaysLeft(r.trial_ends_at, now);
  if (days <= 0) return null;
  return { plan: r.plan, days, endsAt: r.trial_ends_at, urgent: days <= TRIAL_URGENT_DAYS };
}
