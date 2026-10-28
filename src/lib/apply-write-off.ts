import { createAdminClient } from "@/lib/supabase/admin";
import { closeSessionsFor } from "@/lib/table-session";
import type { Order } from "@/lib/types";

/** What a write-off came to: done, refused because part was paid, or nothing left to write off. */
export type WriteOffOutcome =
  | { outcome: "written_off"; amount: number; orderIds: string[] }
  | { outcome: "part_paid"; paid: number }
  | { outcome: "nothing" }
  | { outcome: "failed" };

/**
 * Writes orders off, carrying who and why onto each one.
 *
 * The `written_off = false` in the filter is the important part: two managers
 * looking at the same table would otherwise both write it off, and the reports
 * would count the same loss twice.
 *
 * It runs in `write_off_orders`, under the money lock: a bill with part of it
 * already collected is refused rather than logged as lost in full (paths audit
 * #5), and a collection cannot land between that check and the write. The
 * status it sets is `completed`, not `cancelled`: the food went out and the
 * kitchen spent it, which is the whole reason this is a write-off and not a
 * refund — and /api/orders/cancel is the only path allowed to set
 * `cancelled`, because that one refunds the card first.
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
}): Promise<WriteOffOutcome> {
  const { data, error } = await createAdminClient().rpc("write_off_orders", {
    p_restaurant: restaurantId,
    p_orders: orders.map(o => o.id),
    p_actor: actorEmail,
    p_reason: reason,
    p_note: note || null,
  });
  if (error || !data) return { outcome: "failed" };
  const result = data as { outcome: string; amount?: number; paid?: number; orderIds?: string[]; sessions?: string[] };
  if (result.outcome === "part_paid") return { outcome: "part_paid", paid: Number(result.paid) };
  if (result.outcome !== "written_off") return { outcome: "nothing" };

  // A table whose debt was cancelled is clear: nobody owes anything on it any
  // more, so the sitting closes and whoever was bound to it is freed.
  await closeSessionsFor((result.sessions ?? []).map(session_id => ({ session_id })), "written_off");
  return { outcome: "written_off", amount: Number(result.amount), orderIds: result.orderIds ?? [] };
}

/** Money already collected against these orders: a part-paid bill cannot be written off. */
export async function paidSoFar(restaurantId: string, orderIds: string[]): Promise<number | null> {
  const db = createAdminClient();
  let paid = 0;
  for (const id of orderIds) {
    const { data, error } = await db.rpc("retained_order_coverage", { p_restaurant: restaurantId, p_order: id });
    if (error) return null;
    paid += Number(data ?? 0);
  }
  return Math.round(paid * 100) / 100;
}
