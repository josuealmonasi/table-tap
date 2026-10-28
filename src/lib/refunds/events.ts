import type { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";

export interface ReturnEvent {
  id: string; operation_id: string; order_id: string; kind: "return" | "cancel";
  source: "stripe" | "cash" | "terminal"; currency: string; amount_cents: number;
  succeeded_at: string; payout_actor: string | null; confirmed_by: string | null;
  historical_log_id: string | null;
}
interface EventFilters {
  currency?: string; kind?: "return"; excludeHistorical?: boolean; inclusiveEnd?: boolean;
}

/** A promise can succeed in pieces on different days. SQL exposes each distinct
 * successful piece, including manual evidence, rather than dating the whole
 * promise at its last completion. See docs/returns-audit-ts-handoff.md. */
export async function readReturnEvents(db: ReturnType<typeof createAdminClient>, restaurant: string,
  from: string, to?: string, filters: EventFilters = {}): Promise<ReturnEvent[]> {
  const rows = await everyRow<ReturnEvent>((a, b) => {
    let query = db.rpc("order_return_events_v1", { p_restaurant: restaurant, p_currency: filters.currency ?? null })
      .gte("succeeded_at", from);
    if (to) query = filters.inclusiveEnd ? query.lte("succeeded_at", to) : query.lt("succeeded_at", to);
    if (filters.kind) query = query.eq("kind", filters.kind);
    if (filters.excludeHistorical) query = query.is("historical_log_id", null);
    return query.order("id").range(a, b);
  }, "the successful return amounts");
  if (rows.some(row => !Number.isSafeInteger(row.amount_cents) || row.amount_cents <= 0
    || !Number.isFinite(Date.parse(row.succeeded_at)))) throw new Error("Could not verify dated returns");
  return rows;
}
