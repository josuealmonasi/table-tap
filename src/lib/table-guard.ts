import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Does this table belong to this restaurant?
 *
 * Public routes receive `restaurantId` and `tableId` from the request body,
 * and until now only /api/service-requests checked they were a pair. Without
 * the check you can create an order in restaurant A tagged with a table from
 * restaurant B: crossed rows, a sitting opened on somebody else's table and,
 * since there can only be one open sitting per table, B's real diners end up
 * inside the sitting A opened.
 *
 * Returns the table when they are a pair, or null.
 */
export async function tableOf(
  restaurantId: string,
  tableId: string,
): Promise<{ id: string; label: string } | null> {
  const { data } = await createAdminClient()
    .from("restaurant_tables")
    .select("id, label")
    .eq("id", tableId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  return (data as { id: string; label: string } | null) ?? null;
}
