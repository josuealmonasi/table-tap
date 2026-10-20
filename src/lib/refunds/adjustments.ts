import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { logDetail } from "@/lib/log-detail";
import type { CorteAdjustment } from "@/lib/corte";

/** Only completed returns leave the drawer. Audit text is presentation, never
 * the source of the new return's amount, method, date or payout drawer. */
export async function returnedAdjustments(restaurantId: string, from: string, to?: string): Promise<CorteAdjustment[]> {
  const db = createAdminClient();
  const rows = await everyRow<{ source: string; amount: number; payout_actor: string | null }>((a, b) => {
    let q = db.from("refund_operations").select("source, amount, payout_actor")
      .eq("restaurant_id", restaurantId).eq("status", "succeeded").is("historical_log_id", null).gte("completed_at", from);
    if (to) q = q.lte("completed_at", to);
    return q.order("id").range(a, b);
  }, "the completed order returns");
  return rows.map(r => ({ action: "refunded", detail: logDetail({
    amount: Number(r.amount).toFixed(2), method: r.source === "cash" ? "cash" : "card", collector: r.payout_actor,
  }) }));
}
