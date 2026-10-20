import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { logDetail } from "@/lib/log-detail";
import type { TrailLine } from "@/lib/cash-shift";

interface ReturnedRow {
  amount: number;
  source: string;
  payout_actor: string | null;
  confirmed_by: string | null;
  completed_at: string;
  order_adjustments: { order_id: string };
}

/** Imported returns already have their old log line; only new ones join it. */
export async function returnedTrail(restaurantId: string, from: string, to: string): Promise<TrailLine[]> {
  const db = createAdminClient();
  const rows = await everyRow<ReturnedRow>((a, b) => db.from("refund_operations")
    .select("amount, source, payout_actor, confirmed_by, completed_at, order_adjustments!inner(order_id)")
    .eq("restaurant_id", restaurantId).eq("status", "succeeded").is("historical_log_id", null)
    .gte("completed_at", from).lte("completed_at", to).order("completed_at").order("id").range(a, b).overrideTypes<ReturnedRow[], { merge: false }>(), "the shift's completed returns");
  return rows.map(r => ({ entity: "order", action: "refunded", actor_email: r.payout_actor ?? r.confirmed_by,
    created_at: r.completed_at, detail: logDetail({ amount: Number(r.amount).toFixed(2), order: r.order_adjustments.order_id.slice(0, 8),
      method: r.source === "cash" ? "cash" : "card", collector: r.payout_actor }) }));
}
