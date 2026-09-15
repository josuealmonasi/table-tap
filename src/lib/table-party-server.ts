import { createAdminClient } from "@/lib/supabase/admin";
import { splitCeiling } from "@/lib/table-party";

/**
 * How many people are eating on this table's open bill.
 *
 * SERVER-ONLY: reads with the secret key, scoped by restaurant AND table. The
 * device tokens never leave this file — what callers get is a count.
 *
 * The same set of orders the bill is built from, so the number of shares can
 * never exceed the number of people the bill is actually made of.
 */
export async function tableParty(restaurantId: string, tableId: string): Promise<number> {
  const { data } = await createAdminClient()
    .from("orders")
    .select("diner")
    .eq("restaurant_id", restaurantId)
    .eq("table_id", tableId)
    .eq("paid", false)
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .neq("status", "cancelled");
  return splitCeiling((data ?? []) as { diner: string | null }[]);
}
