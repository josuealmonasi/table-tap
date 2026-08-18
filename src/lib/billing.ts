import type { PlanName, PlanStatus } from "./plan";

/**
 * What a Stripe subscription status means for a restaurant.
 *
 * Pure, so the mapping can be argued with in a test rather than discovered in
 * production. Stripe drives the whole dunning schedule — retries, and how long
 * before it gives up — so this file only mirrors what Stripe decided.
 */
export interface BillingOutcome {
  plan: PlanName;
  status: PlanStatus;
}

/**
 * Cancelling is not the same as not paying.
 *
 * A restaurant that cancels deliberately becomes a free customer and keeps
 * working on the free tier — locking them out would punish someone who did
 * exactly what we asked them to do to leave. `unpaid` is the one that freezes,
 * and only ever the dashboard.
 */
export function subscriptionOutcome(
  stripeStatus: string,
  plan: PlanName,
): BillingOutcome {
  switch (stripeStatus) {
    case "trialing":
      return { plan, status: "trialing" };
    case "active":
      return { plan, status: "active" };
    case "past_due":
    case "incomplete":
      return { plan, status: "past_due" };
    case "unpaid":
    case "paused":
      return { plan, status: "locked" };
    case "canceled":
    case "incomplete_expired":
      return { plan: "carta", status: "active" };
    default:
      // A status Stripe added after this was written. Keeping them working
      // with a banner is the safe direction to be wrong in: the alternative
      // is freezing a restaurant that has paid.
      return { plan, status: "past_due" };
  }
}

const PLANS: PlanName[] = ["carta", "servicio", "casa", "grupo"];

/** A plan name from untrusted input — webhook metadata, or a request body. */
export function readPlanName(value: unknown): PlanName | null {
  return typeof value === "string" && PLANS.includes(value as PlanName)
    ? (value as PlanName)
    : null;
}

/** Whether a tier is something a restaurant can subscribe to by itself. */
export function isSelfServe(plan: PlanName): boolean {
  // Carta is free — there is nothing to check out. Grupo is multi-location,
  // which is a conversation and a contract before it is a card.
  return plan === "servicio" || plan === "casa";
}
