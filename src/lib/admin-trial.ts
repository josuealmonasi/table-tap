import type { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { invalidatePublicMenu } from "@/lib/public-menu-cache";

type Db = ReturnType<typeof createAdminClient>;
export type TrialAnswer = { ok: true } | { ok: false; error: string; status: number };
const MAX_DAYS = 90;

/**
 * A platform admin extends a running trial to a date, or ends it now. Ending
 * it does exactly what an expired trial does (getPlan's endTrial): Carta,
 * active, nothing deleted. Only the app's own trial: a restaurant paying
 * through Stripe has Stripe's dates, and changing them here would be undone by
 * the next billing event. Over the sync revision read, like every plan write.
 */
export async function changeTrial(db: Db, restaurantId: string, endsAt: string | null, adminEmail: string, now = Date.now()): Promise<TrialAnswer> {
  if (endsAt !== null) {
    const at = new Date(endsAt).getTime();
    if (!Number.isFinite(at) || at <= now || at > now + MAX_DAYS * 86_400_000) return { ok: false, error: "apiErr.trialDateInvalid", status: 400 };
  }
  const { data: r, error: readError } = await db.from("restaurants")
    .select("id, plan, plan_status, trial_ends_at, stripe_subscription_id, subscription_sync_revision").eq("id", restaurantId).maybeSingle();
  if (readError) return { ok: false, error: "apiErr.generic", status: 500 };
  if (!r) return { ok: false, error: "apiErr.restaurantNotFound", status: 404 };
  if (r.stripe_subscription_id) return { ok: false, error: "apiErr.planHasSubscription", status: 409 };
  if (r.plan_status !== "trialing") return { ok: false, error: "apiErr.notOnTrial", status: 409 };
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
}
