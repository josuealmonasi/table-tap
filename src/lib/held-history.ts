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

/** Merge the two decision clocks before paging, so a recent resolution cannot
 * disappear behind old approvals. Read in chunks to respect the Data API cap. */
export async function heldHistory(restaurantId: string, requestedFrom: number, size: number) {
  const db = createAdminClient();
  // Each clock is read in full up to the page, so a page past the end read
  // the whole history twice (review access3). The page is clamped to the last
  // one there is, counted per clock as the merge below counts them.
  const decided = async (clock: "approved_at" | "resolved_at") => {
    const { count, error } = await db.from("offline_sale_queue").select("pos_ref", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId).not(clock, "is", null);
    if (error || count == null) throw new Error(`Could not count held history: ${error?.message ?? "no count"}`);
    return count;
  };
  const [approvedCount, resolvedCount] = await Promise.all([decided("approved_at"), decided("resolved_at")]);
  const from = Math.min(requestedFrom, lastPageStart(approvedCount + resolvedCount, size));
  const read = (clock: "approved_at" | "resolved_at") => everyRow<HistoryRow>((a, b) => a > from + size ? Promise.resolve({ data: [], error: null }) : db.from("offline_sale_queue")
    .select(clock === "resolved_at" ? `${columns}, resolution:held_sale_resolutions(disposition, resolved_by, resolved_at, reason, amount, currency, cash_receipt_id, payment_id, payout_id)` : columns)
    .eq("restaurant_id", restaurantId).not(clock, "is", null)
    .order(clock, { ascending: false }).order("pos_ref").range(a, Math.min(b, from + size)).returns<HistoryRow[]>(), "held history");
  const [approved, resolved] = await Promise.all([read("approved_at"), read("resolved_at")]);
  const rows = [...approved, ...resolved].map(row => ({ ...row,
    resolution: Array.isArray(row.resolution) ? row.resolution[0] ?? null : row.resolution ?? null,
  })).sort((a, b) => (b.resolved_at ?? b.approved_at ?? "").localeCompare(a.resolved_at ?? a.approved_at ?? "") || a.pos_ref.localeCompare(b.pos_ref));
  return { sales: rows.slice(from, from + size), hasMore: rows.length > from + size };
}
