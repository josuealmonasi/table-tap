import { createAdminClient } from "@/lib/supabase/admin";
import { checkoutRowsIn } from "@/lib/checkout-page-scope";

/** Either linked row can still be awaiting Stripe; a local deadline cannot clear it. */
export async function unresolvedAccounts(restaurantId: string, accountIds: string[]): Promise<Set<string>> {
  const db = createAdminClient();
  const checkouts = await checkoutRowsIn<{ id: string; account_id: string; status: string }>(accountIds, (ids, from, to) => db
    .from("account_checkouts").select("id, account_id, status").eq("restaurant_id", restaurantId)
    .in("account_id", ids).order("id").range(from, to));
  const attempts = await checkoutRowsIn<{ id: string; metadata: { account_checkout: string } }>(checkouts.map(c => c.id), (ids, from, to) => db
    .from("diner_checkouts").select("id, metadata").eq("restaurant_id", restaurantId).eq("status", "open")
    .in("metadata->>account_checkout", ids).order("id").range(from, to));
  const open = new Set(attempts.map(a => a.metadata.account_checkout));
  return new Set(checkouts.filter(c => c.status === "open" || open.has(c.id)).map(c => c.account_id));
}
