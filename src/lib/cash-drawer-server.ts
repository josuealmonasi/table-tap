import { createAdminClient } from "@/lib/supabase/admin";
import type { CashMovement } from "@/lib/cash-drawer";

/**
 * Today's movements of a restaurant's cash drawer, since the start of its day.
 *
 * Read with the secret key: `cash_movements` is granted to nobody but the
 * server, and the callers have already checked who is asking.
 */
export async function drawerMovements(restaurantId: string, since: Date): Promise<CashMovement[]> {
  const { data, error } = await createAdminClient()
    .from("cash_movements")
    .select("id, kind, amount, note, actor_email, created_at")
    .eq("restaurant_id", restaurantId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true });
  if (error) throw new Error(`the cash drawer: ${error.message}`);
  return (data ?? []).map(m => ({ ...m, amount: Number(m.amount) })) as CashMovement[];
}
