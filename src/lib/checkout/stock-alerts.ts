import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StockWarning } from "@/lib/stock";

/** Pending food can come back; never clear a committed sale's warning with it. */
export function checkoutStockAlerts(restaurantId: string, warnings: StockWarning[]) {
  const rows = warnings.map(w => ({
    id: randomUUID(), restaurant_id: restaurantId, kind: w.kind,
    data: { itemId: w.itemId, name: w.name, stock: w.stock },
  }));
  return {
    async raise(): Promise<void> {
      if (!rows.length) return;
      try {
        await createAdminClient().from("notifications").insert(rows);
      } catch {
        // A missing bell entry must not stop somebody paying for their food.
      }
    },
    async clear(): Promise<void> {
      for (const row of rows) {
        const { error } = await createAdminClient().from("notifications").delete()
          .eq("restaurant_id", restaurantId).eq("id", row.id).eq("data->>itemId", row.data.itemId);
        if (error) throw new Error(`Could not clear failed checkout warning: ${error.message}`);
      }
    },
  };
}
