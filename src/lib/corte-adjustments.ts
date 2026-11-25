import type { CorteAdjustment } from "@/lib/corte";
import { corteLogs, type CorteLog } from "@/lib/corte-log";
import { everyRow } from "@/lib/paged";
import { returnAdjustmentsFrom } from "@/lib/refunds/adjustments";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Everything `corteFrom` subtracts or sets aside for one window: bill
 * write-offs and logged refunds from the activity log, plus every completed
 * return from the canonical return events.
 *
 * The Analytics corte and the daily digest both read it here. The digest used
 * to pass payments alone, so MX$100 collected in cash with MX$30 handed back
 * from that drawer read MX$100 cash in the mail and MX$70 on the corte
 * (bl24, finding 4). One reader, so the two cannot drift apart again.
 */
export async function readCorteAdjustments(db: ReturnType<typeof createAdminClient>, restaurantId: string,
  currency: string, from: string, to?: string): Promise<{ verified: CorteAdjustment[]; unverified: number }> {
  const [logs, returns] = await Promise.all([
    everyRow<CorteLog>((a, b) => {
      const query = db.from("user_logs").select("entity, action, detail")
        .eq("restaurant_id", restaurantId)
        // "refunded" is money handed back after it arrived. It comes out of the
        // drawer of whoever took it, which is why the corte needs to see it.
        .in("action", ["written_off", "refunded"])
        .gte("created_at", from)
        .order("id").range(a, b);
      return to ? query.lt("created_at", to) : query;
    }, "the period's write-offs and refunds"),
    returnAdjustmentsFrom(db, restaurantId, from, to, currency),
  ]);
  const log = corteLogs(logs, currency);
  return { verified: [...log.verified, ...returns], unverified: log.unverified };
}
