import { createAdminClient } from "@/lib/supabase/admin";
import type { Order } from "@/lib/types";

/**
 * Marks orders cancelled, carrying who and why onto each one.
 *
 * The `written_off = false` in the filter is the important part: two managers
 * looking at the same table would otherwise both write it off, and the reports
 * would count the same loss twice.
 */
export async function applyWriteOff({
  orders,
  restaurantId,
  actorEmail,
  reason,
  note,
}: {
  orders: Order[];
  restaurantId: string;
  actorEmail: string;
  reason: string;
  note: string;
}): Promise<boolean> {
  const { error } = await createAdminClient()
    .from("orders")
    .update({
      written_off: true,
      write_off_reason: reason,
      write_off_note: note || null,
      written_off_by: actorEmail,
      written_off_at: new Date().toISOString(),
    })
    .in(
      "id",
      orders.map(o => o.id),
    )
    .eq("restaurant_id", restaurantId)
    .eq("written_off", false);
  return !error;
}
