import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { corteFrom, type CortePayment } from "@/lib/corte";
import { corteLogs, type CorteLog } from "@/lib/corte-log";
import { returnedAdjustments } from "@/lib/refunds/adjustments";

/**
 * What the restaurant has collected since `dayStart`, net of what it handed
 * back: the figure the corte signs for (every drawer plus online card money).
 *
 * The orders board used to add up today's PAID ORDERS instead. A MX$50
 * collection on a MX$100 order, a paid split share, and yesterday's account
 * order settled today all arrive as payments without a paid order created
 * today, so the board read MX$0 for money in the drawer (audit N, finding 4).
 * Read from the same ledger and the same returns as the corte, the two
 * screens cannot disagree.
 */
export async function collectedToday(restaurantId: string, currency: string, dayStart: Date): Promise<number> {
  const admin = createAdminClient();
  const since = dayStart.toISOString();
  const [paid, logs, returns] = await Promise.all([
    everyRow<CortePayment>((a, b) => admin
      .from("payments")
      .select("actor_email, amount, method")
      .eq("restaurant_id", restaurantId).eq("currency", currency)
      .gte("created_at", since)
      .order("id").range(a, b), "today's takings"),
    // Only money handed back matters here; corteLogs keeps the refunds that
    // left a drawer or a card, in this currency.
    everyRow<CorteLog>((a, b) => admin
      .from("user_logs")
      .select("entity, action, detail")
      .eq("restaurant_id", restaurantId)
      .eq("action", "refunded")
      .gte("created_at", since)
      .order("id").range(a, b), "today's refunds"),
    returnedAdjustments(restaurantId, since, undefined, currency),
  ]);
  const corte = corteFrom(paid, [...corteLogs(logs, currency).verified, ...returns]);
  return Math.round((corte.totals.total + corte.online) * 100) / 100;
}
