import { createAdminClient } from "@/lib/supabase/admin";
import { readReturnEvents } from "./events";
import { logDetail } from "@/lib/log-detail";
import type { CorteAdjustment } from "@/lib/corte";

/** Only completed returns leave the drawer. Audit text is presentation, never
 * the source of the new return's amount, method, date or payout drawer. */
export async function returnedAdjustments(restaurantId: string, from: string, to?: string, currency?: string): Promise<CorteAdjustment[]> {
  const db = createAdminClient();
  const rows = await readReturnEvents(db, restaurantId, from, to, { currency, excludeHistorical: true });
  return rows.map(r => ({ action: "refunded", detail: logDetail({
    amount: (r.amount_cents / 100).toFixed(2), method: r.source === "cash" ? "cash" : "card", collector: r.payout_actor,
  }) }));
}
