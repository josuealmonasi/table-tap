import type { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { invalidatePublicMenu } from "@/lib/public-menu-cache";

type Db = ReturnType<typeof createAdminClient>;
export const SUSPENSION_REASONS = ["non_payment", "abuse", "owner_request", "other"] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];

export type SuspendAnswer = { ok: true } | { ok: false; error: string; status: number };

/**
 * A platform admin suspends a restaurant: it starts no new sales until
 * unsuspended (checkout, table orders, POS — `restaurant-suspension.ts`).
 * Bills already open stay payable and refunds keep working; nothing is
 * deleted. Written in the restaurant's own activity log, so the owner sees who
 * and why.
 */
export async function setSuspension(
  db: Db, restaurantId: string, suspend: { reason: SuspensionReason } | null, adminEmail: string,
): Promise<SuspendAnswer> {
  const { data: restaurant, error: readError } = await db.from("restaurants")
    .select("id, suspended_at").eq("id", restaurantId).maybeSingle();
  if (readError) return { ok: false, error: "apiErr.generic", status: 500 };
  if (!restaurant) return { ok: false, error: "apiErr.restaurantNotFound", status: 404 };
  if (suspend && restaurant.suspended_at) return { ok: false, error: "apiErr.alreadySuspended", status: 409 };
  if (!suspend && !restaurant.suspended_at) return { ok: false, error: "apiErr.notSuspended", status: 409 };

  const patch = suspend
    ? { suspended_at: new Date().toISOString(), suspended_reason: suspend.reason, suspended_by: adminEmail }
    : { suspended_at: null, suspended_reason: null, suspended_by: null };
  // Only over the state read above: two admins acting at once get one answer each.
  const query = db.from("restaurants").update(patch).eq("id", restaurantId);
  const { data: changed, error } = await (suspend ? query.is("suspended_at", null) : query.not("suspended_at", "is", null)).select("id");
  if (error) return { ok: false, error: "apiErr.generic", status: 500 };
  if (!changed?.length) return { ok: false, error: "apiErr.planChangedMeanwhile", status: 409 };

  invalidatePublicMenu(restaurantId);
  await logEvent({
    restaurantId, actor: adminEmail, entity: "settings", action: "updated",
    detail: logDetail(suspend ? { suspended: suspend.reason, by: "platform_admin" } : { suspended: "lifted", by: "platform_admin" }),
  });
  return { ok: true };
}
