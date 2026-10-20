import type { createAdminClient } from "@/lib/supabase/admin";
import { currentOfflinePrice } from "@/lib/offline-pricing";
import { offlineDrift, type OfflineCharge } from "@/lib/offline-sale";
import type { OrderLineItem } from "@/lib/types";
import type { QueuedOfflineSale } from "@/lib/offline-review";

export interface OfflineComparison {
  currency: string;
  lines: OrderLineItem[];
  charge: Omit<OfflineCharge, "at">;
  /** Collected minus today's menu, calculated on the server. */
  difference: number;
}

/** Read the immutable receipt, never prices supplied by the review browser. */
export async function compareOfflineSale(db: ReturnType<typeof createAdminClient>, restaurantId: string, sale: QueuedOfflineSale): Promise<OfflineComparison | null> {
  try {
    const { data, error } = await db.from("restaurants").select("currency, service_pct, service_enabled").eq("id", restaurantId).single();
    // Different currencies cannot describe a price change; no conversion is implied.
    if (error || !data || !sale.currency || sale.currency !== data.currency) return null;
    const current = await currentOfflinePrice(db, restaurantId, sale.body, data);
    if (!current) return null;
    const { subtotal, serviceFee, tip, discount, total } = current.price;
    return { currency: sale.currency, lines: current.lines, charge: { subtotal, serviceFee, tip, discount, total },
      difference: offlineDrift(sale.body.offline.total, total)! };
  } catch { return null; }
}
