import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import type { QueuedOfflineSale } from "@/lib/offline-review";
import type { HeldResolution } from "@/lib/held-resolution";

const columns = "pos_ref, body, collector, currency, submitted_by, reason, approved_by, approved_at, resolved_at";
interface HistoryRow extends Omit<QueuedOfflineSale, "resolution"> { resolution?: HeldResolution | HeldResolution[] | null }

/** Where the last page of `total` rows starts; 0 when there are none. */
export function lastPageStart(total: number, size: number): number {
  return Math.max(0, Math.ceil(total / size) - 1) * size;
}

/** Merge decision clocks before paging, so a recent resolution cannot hide
 * behind old approvals. Page in the database to respect the Data API cap
 * without reading every earlier decision into the server. */
export async function heldHistory(restaurantId: string, requestedFrom: number, size: number) {
  const db = createAdminClient();
  // Count the merged clock once: a page past the end reads only the last
  // page, never a prefix of the full history (review N13).
  const { count, error } = await db.from("offline_sale_queue").select("pos_ref", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId).not("decision_at", "is", null);
  if (error || count == null) throw new Error(`Could not count held history: ${error?.message ?? "no count"}`);
  const from = Math.min(requestedFrom, lastPageStart(count, size));
  const rows = await everyRow<HistoryRow>((a, b) => a > size ? Promise.resolve({ data: [], error: null }) : db.from("offline_sale_queue")
    .select(`${columns}, resolution:held_sale_resolutions(disposition, resolved_by, resolved_at, reason, amount, currency, cash_receipt_id, payment_id, payout_id)`)
    .eq("restaurant_id", restaurantId).not("decision_at", "is", null)
    .order("decision_at", { ascending: false }).order("pos_ref")
    .range(from + a, from + Math.min(b, size)).returns<HistoryRow[]>(), "held history");
  return { sales: rows.slice(0, size).map(row => ({ ...row,
    resolution: Array.isArray(row.resolution) ? row.resolution[0] ?? null : row.resolution ?? null,
  })), hasMore: rows.length > size };
}
