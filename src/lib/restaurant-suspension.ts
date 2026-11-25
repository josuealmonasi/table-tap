import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api-error";

export const RESTAURANT_CLOSING_CODE = "PT423";

/**
 * A suspended restaurant (a platform admin's decision: non-payment, abuse, an
 * owner's request) starts no new sales. One answer everywhere a sale starts,
 * so the screens can say the same thing.
 */
export async function suspensionRefusal(suspendedAt: unknown) {
  return suspendedAt ? await apiError("apiErr.restaurantSuspended", 409) : null;
}

/**
 * The till's answer while suspended. A new sale is refused. Money the till
 * already collected is never lost: collected before the suspension, it is
 * recorded as usual (null here); collected after it — the device was offline
 * and could not know — it stays on the device as held, for a manager to
 * resolve, the way every collected sale the server cannot settle does.
 */
export async function posSuspensionAnswer(suspendedAt: unknown, collectedAt: string | null, queuedBefore = false) {
  if (!suspendedAt) return null;
  if (!collectedAt) return await apiError("apiErr.restaurantSuspended", 409);
  // The collection time is the device's word. Recorded as usual only when the
  // server already holds this sale from before the suspension (its offline
  // queue row); otherwise a cashier could date a new sale before it and ring
  // it while suspended (security sweep 2026-11-24). Held, a manager decides.
  if (queuedBefore && new Date(collectedAt).getTime() < new Date(String(suspendedAt)).getTime()) return null;
  return await apiError("apiErr.restaurantSuspended", 409, undefined, { held: true });
}

/** Whether the server queued this sale before the restaurant was suspended. */
export async function queuedBeforeSuspension(
  db: SupabaseClient, restaurantId: string, posRef: string | undefined, suspendedAt: unknown,
): Promise<boolean> {
  if (!suspendedAt || !posRef) return false;
  const { data, error } = await db.from("offline_sale_queue").select("received_at")
    .eq("restaurant_id", restaurantId).eq("pos_ref", posRef).lt("received_at", String(suspendedAt)).maybeSingle();
  return !error && Boolean(data);
}

/**
 * What a diner's menu shows for a suspended restaurant: the same as one that
 * paused orders (readable, nothing offered to order), which is exactly what
 * checkout answers. Both menu loaders (cached in production, direct on dev)
 * go through this, so they cannot disagree.
 */
export function asDinerSees<T extends { accepting_orders: boolean }>(restaurant: T, salesPausedAt: unknown): T {
  return salesPausedAt ? { ...restaurant, accepting_orders: false } : restaurant;
}
