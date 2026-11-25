import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { invalidatePublicMenu } from "@/lib/public-menu-cache";
import { BillingError, withRestaurantBilling } from "@/lib/billing-operation";
import { restaurantBilling } from "@/lib/billing-state";

type Db = ReturnType<typeof createAdminClient>;
export type TrialAnswer = { ok: true } | { ok: false; error: string; status: number };
const MAX_DAYS = 90;

/**
 * A platform admin extends a running trial to a date, or ends it now. Ending
 * it does exactly what an expired trial does (getPlan's endTrial): Carta,
 * active, nothing deleted. Only the app's own trial: a restaurant paying
 * through Stripe has Stripe's dates, and changing them here would be undone by
 * the next billing event. Over the sync revision read, like every plan write.
 *
 * Under the restaurant billing lock, like every other tier move. Ending or
 * shortening a tier assignment closes the Checkout pages opened for it: one
 * left open would otherwise still be payable and bring the paid tier back
 * (review bl26, finding 5). A checkout that already completed, before its
 * webhook arrived, refuses the change instead.
 */
export async function changeTrial(
  db: Db, restaurantId: string, endsAt: string | null, adminEmail: string, now = Date.now(), client: Stripe = stripe,
): Promise<TrialAnswer> {
  if (endsAt !== null) {
    const at = new Date(endsAt).getTime();
    if (!Number.isFinite(at) || at <= now || at > now + MAX_DAYS * 86_400_000) return { ok: false, error: "apiErr.trialDateInvalid", status: 400 };
  }
  try {
    return await withRestaurantBilling(db, restaurantId, async (operation): Promise<TrialAnswer> => {
      const { data: r, error: readError } = await db.from("restaurants")
        .select("id, plan, plan_status, trial_ends_at, stripe_subscription_id, subscription_sync_revision").eq("id", restaurantId).maybeSingle();
      if (readError) return { ok: false, error: "apiErr.generic", status: 500 };
      if (!r) return { ok: false, error: "apiErr.restaurantNotFound", status: 404 };
      if (r.stripe_subscription_id) return { ok: false, error: "apiErr.planHasSubscription", status: 409 };
      if (r.plan_status !== "trialing") return { ok: false, error: "apiErr.notOnTrial", status: 409 };

      const { live, sessions, snapshot, exists } = await restaurantBilling(db, restaurantId);
      if (!exists) return { ok: false, error: "apiErr.restaurantNotFound", status: 404 };
      await operation.record(snapshot);
      // Stripe can already be billing before the webhook saves the subscription ID.
      if (live.length) return { ok: false, error: "apiErr.planHasSubscription", status: 409 };
      const currentEnd = Date.parse(r.trial_ends_at ?? "");
      const shortens = endsAt === null || !Number.isFinite(currentEnd) || new Date(endsAt).getTime() < currentEnd;
      if (shortens) {
        // Only pages bound to an assignment: a trial owner's own checkout
        // for a plan they chose stays theirs to pay. A failure throws, and
        // the deadline is not changed.
        for (const session of sessions) {
          if (session.metadata?.tier_assignment_id) await operation.write(() => client.checkout.sessions.expire(session.id));
        }
      }

      const revision = Number(r.subscription_sync_revision ?? 0);
      const patch = endsAt === null
        ? { plan: "carta", plan_status: "active", trial_ends_at: null, tier_assignment_id: null, subscription_sync_revision: revision + 1 }
        : { trial_ends_at: new Date(endsAt).toISOString(), subscription_sync_revision: revision + 1 };
      const { data: changed, error } = await db.from("restaurants").update(patch)
        .eq("id", restaurantId).eq("subscription_sync_revision", revision).select("id");
      if (error) return { ok: false, error: "apiErr.generic", status: 500 };
      if (!changed?.length) return { ok: false, error: "apiErr.planChangedMeanwhile", status: 409 };
      invalidatePublicMenu(restaurantId);
      await logEvent({
        restaurantId, actor: adminEmail, entity: "settings", action: "updated",
        detail: logDetail(endsAt === null ? { trial: "ended", plan: `${r.plan}→carta`, by: "platform_admin" }
          : { trial: `until_${new Date(endsAt).toISOString().slice(0, 10)}`, by: "platform_admin" }),
      });
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof BillingError) return { ok: false, error: err.key, status: err.status };
    console.error("admin trial change failed", err);
    return { ok: false, error: "apiErr.billingUnavailable", status: 502 };
  }
}
