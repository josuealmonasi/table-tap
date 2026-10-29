import { createAdminClient } from "@/lib/supabase/admin";
import { readReturnEvents } from "./events";
import { logDetail } from "@/lib/log-detail";
import type { TrailLine } from "@/lib/cash-shift";

/** Imported returns already have their old log line; only new ones join it. */
export async function returnedTrail(restaurantId: string, from: string, to: string): Promise<TrailLine[]> {
  const db = createAdminClient();
  const rows = await readReturnEvents(db, restaurantId, from, to, { excludeHistorical: true, inclusiveEnd: true });
  return rows.map(r => ({ entity: "order", action: "refunded", actor_email: r.payout_actor ?? r.confirmed_by,
    created_at: r.succeeded_at, detail: logDetail({ amount: (r.amount_cents / 100).toFixed(2), order: r.order_id.slice(0, 8),
      method: r.source === "cash" ? "cash" : "card", collector: r.payout_actor }) }));
}
