import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cash taken offline that waits for a manager's review: in the drawer, with no
 * payment row behind it yet. A shift signed off with it showed a false surplus
 * that the later approval could not unsign (C4, end-to-end review).
 */
export async function heldCashWaiting(db: ReturnType<typeof createAdminClient>, restaurantId: string): Promise<number> {
  const { count, error } = await db.from("offline_sale_queue").select("pos_ref", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId).is("approved_at", null).is("resolved_at", null).eq("body->>method", "cash");
  if (error || count === null) throw new Error(`Could not read the cash awaiting review: ${error?.message ?? "no count"}`);
  return count;
}
