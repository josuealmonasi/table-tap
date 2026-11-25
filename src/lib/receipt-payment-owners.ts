import type { createAdminClient } from "@/lib/supabase/admin";

type Database = ReturnType<typeof createAdminClient>;

export async function receiptPaymentOwners(
  db: Database, restaurantId: string, intents: readonly (string | null)[],
): Promise<Map<string, { payer_member_id: string | null; split_id: string | null }>> {
  const ids = [...new Set(intents.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  const { data, error } = await db.from("diner_checkouts")
    .select("stripe_payment_intent, payer_member_id, split_id")
    .eq("restaurant_id", restaurantId).in("stripe_payment_intent", ids);
  if (error) throw new Error("Could not read receipt payment owners");
  return new Map((data ?? []).map(row => [row.stripe_payment_intent, row]));
}

/** An order on a whole bill belongs to its recorded payer as well as its ordering phone. */
export async function ownPaidOrderIds(
  db: Database, restaurantId: string, sessionId: string, memberId: string, orderIds: string[],
): Promise<Set<string>> {
  if (!orderIds.length) return new Set();
  const { data, error } = await db.from("payments").select("order_id, stripe_payment_intent")
    .eq("restaurant_id", restaurantId).eq("session_id", sessionId).in("order_id", orderIds);
  if (error) throw new Error("Could not read order payments");
  const payments = data ?? [];
  const owners = await receiptPaymentOwners(db, restaurantId, payments.map(p => p.stripe_payment_intent));
  return new Set(payments.filter(p => {
    const owner = owners.get(p.stripe_payment_intent);
    return owner?.payer_member_id === memberId && owner.split_id === null;
  }).map(p => p.order_id));
}
