import type { createAdminClient } from "@/lib/supabase/admin";

/** A split cannot attribute one paid part to two different saved tax rates. */
export async function splitVatRate(
  db: ReturnType<typeof createAdminClient>, restaurantId: string, orderIds: unknown,
): Promise<number | null> {
  if (!Array.isArray(orderIds) || !orderIds.length || orderIds.length > 100
    || orderIds.some(id => typeof id !== "string")) return null;
  const ids = [...new Set(orderIds as string[])];
  // Tax is optional on paper: an unread rate must never stop a receipt.
  try {
    const { data, error } = await db.from("orders").select("id, tax_pct")
      .eq("restaurant_id", restaurantId).in("id", ids);
    if (error || !data || data.length !== ids.length) return null;
    const rates = data.map(row => row.tax_pct == null ? NaN : Number(row.tax_pct));
    const rate = rates[0];
    return Number.isFinite(rate) && rate >= 0 && rate <= 100 && rates.every(value => value === rate) ? rate : null;
  } catch { return null; }
}
