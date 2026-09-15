import { createAdminClient } from "@/lib/supabase/admin";
import { closeSessionsFor } from "@/lib/table-session";
import type { Order } from "@/lib/types";

/**
 * Writes orders off, carrying who and why onto each one.
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
  const { data: updated, error } = await createAdminClient()
    .from("orders")
    .update({
      written_off: true,
      write_off_reason: reason,
      write_off_note: note || null,
      written_off_by: actorEmail,
      written_off_at: new Date().toISOString(),
      // And off every screen that shows live work. A table whose debt was
      // cancelled kept its orders at "received", so the kitchen still had
      // tickets for a table that had gone and the diner's phone still offered
      // "follow your order ORD-09BB" three times over — on a table the floor
      // had cleared for the next party.
      //
      // `completed`, not `cancelled`: the food went out and the kitchen spent
      // it, which is the whole reason this is a write-off and not a refund —
      // and /api/orders/cancel is the only path allowed to set `cancelled`,
      // because that one refunds the card first.
      status: "completed",
    })
    .in(
      "id",
      orders.map(o => o.id),
    )
    .eq("restaurant_id", restaurantId)
    .eq("written_off", false)
    // A cancelled order stays cancelled: it was refunded under that name.
    .neq("status", "cancelled")
    .select("session_id");
  if (error) return false;

  // A table whose debt was cancelled is clear: nobody owes anything on it any
  // more, so the sitting closes and whoever was bound to it is freed.
  await closeSessionsFor(updated ?? [], "written_off");
  return true;
}
