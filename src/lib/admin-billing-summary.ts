import { formatMoney, dateLocale } from "@/lib/format";
import type { PlanStatus } from "@/lib/plan";

/** What the admin page reads for each restaurant: the columns the Stripe sync keeps current. */
export interface RestaurantBilling {
  plan: string;
  plan_status: PlanStatus;
  stripe_subscription_id: string | null;
  /** Monthly pesos Stripe charges, or null when nothing is billed. */
  subscribed_price: number | null;
  trial_ends_at: string | null;
  /** Set once a subscription is cancelled: the last day it was paid for. */
  plan_ends_at: string | null;
  /** The end of the period Stripe has been paid for: the next renewal. */
  plan_period_ends_at: string | null;
  /** Set while a platform admin has the restaurant suspended (no new sales). */
  suspended_at?: string | null;
  suspended_reason?: string | null;
}

export type BillingTone = "ok" | "warn" | "danger" | "muted";

type T = (key: string, vars?: Record<string, string | number>) => string;

/**
 * One line telling a platform admin how a restaurant pays for its plan, from
 * the columns the subscription webhook writes. No Stripe call per row: the
 * page lists every restaurant, and this is what the app itself enforces.
 */
export function billingSummary(r: RestaurantBilling, t: T, locale: string): { text: string; tone: BillingTone } {
  const day = (iso: string) => new Intl.DateTimeFormat(dateLocale(locale), {
    day: "numeric", month: "short", timeZone: "America/Mexico_City",
  }).format(new Date(iso));
  const price = r.subscribed_price === null ? null : `${formatMoney(r.subscribed_price, "MXN")}`;

  // A suspension outranks every billing state: nothing sells until it is lifted.
  if (r.suspended_at) {
    return { text: t("adminBilling.suspended", { reason: t(`adminSuspend.reason_${r.suspended_reason ?? "other"}`) }), tone: "danger" };
  }
  if (r.plan_status === "locked") return { text: t("adminBilling.locked"), tone: "danger" };
  if (r.plan_status === "past_due") return { text: t("adminBilling.pastDue"), tone: "danger" };
  if (r.stripe_subscription_id) {
    if (r.plan_ends_at) return { text: t("adminBilling.cancelling", { date: day(r.plan_ends_at) }), tone: "warn" };
    if (r.plan_status === "trialing" && r.trial_ends_at) {
      return { text: t("adminBilling.stripeTrial", { date: day(r.trial_ends_at) }), tone: "ok" };
    }
    const renews = r.plan_period_ends_at ? day(r.plan_period_ends_at) : null;
    if (price && renews) return { text: t("adminBilling.paying", { price, date: renews }), tone: "ok" };
    return { text: t("adminBilling.payingNoDate"), tone: "ok" };
  }
  // No subscription: a trial (the app's own, or a tier assigned with a payment
  // link, which is stored the same way) ends on its date and drops to Carta.
  if (r.plan_status === "trialing" && r.trial_ends_at) {
    return { text: t("adminBilling.unpaidUntil", { date: day(r.trial_ends_at) }), tone: "warn" };
  }
  if (r.plan === "carta") return { text: t("adminBilling.free"), tone: "muted" };
  return { text: t("adminBilling.comped"), tone: "muted" };
}
