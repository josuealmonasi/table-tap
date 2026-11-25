import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * The cash shift open when a till sale arrives: the drawer its cash goes into.
 * Read before the sale is priced and rung, and passed to ring_pos_sale_v3,
 * which binds the receipt to it. A close that lands while the sale is on its
 * way leaves the sale with this shift, as cash that arrived after the count,
 * never with the next one (bl39 finding 2).
 *
 * Null when no shift is open, or when the read fails: the sale is not refused
 * for it, and an unbound receipt is counted by its time as before.
 */
export async function collectingShiftId(db: ReturnType<typeof createAdminClient>, restaurantId: string): Promise<string | null> {
  const { data, error } = await db.from("cash_shifts").select("id")
    .eq("restaurant_id", restaurantId).is("closed_at", null).maybeSingle();
  return error || !data ? null : (data.id as string);
}
