import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import type { QueuedOfflineSale } from "@/lib/offline-review";
import type { HeldResolution } from "@/lib/held-resolution";

const columns = "pos_ref, body, collector, currency, submitted_by, reason, approved_by, approved_at, resolved_at";
interface HistoryRow extends Omit<QueuedOfflineSale, "resolution"> { resolution?: HeldResolution | HeldResolution[] | null }

/** Merge the two decision clocks before paging, so a recent resolution cannot
 * disappear behind old approvals. Read in chunks to respect the Data API cap. */
export async function heldHistory(restaurantId: string, from: number, size: number) {
  const db = createAdminClient();
  const read = (clock: "approved_at" | "resolved_at") => everyRow<HistoryRow>((a, b) => a > from + size ? Promise.resolve({ data: [], error: null }) : db.from("offline_sale_queue")
    .select(clock === "resolved_at" ? `${columns}, resolution:held_sale_resolutions(disposition, resolved_by, resolved_at, reason, amount, currency)` : columns)
    .eq("restaurant_id", restaurantId).not(clock, "is", null)
    .order(clock, { ascending: false }).order("pos_ref").range(a, Math.min(b, from + size)).returns<HistoryRow[]>(), "held history");
  const [approved, resolved] = await Promise.all([read("approved_at"), read("resolved_at")]);
  const rows = [...approved, ...resolved].map(row => ({ ...row,
    resolution: Array.isArray(row.resolution) ? row.resolution[0] ?? null : row.resolution ?? null,
  })).sort((a, b) => (b.resolved_at ?? b.approved_at ?? "").localeCompare(a.resolved_at ?? a.approved_at ?? "") || a.pos_ref.localeCompare(b.pos_ref));
  return { sales: rows.slice(from, from + size), hasMore: rows.length > from + size };
}
