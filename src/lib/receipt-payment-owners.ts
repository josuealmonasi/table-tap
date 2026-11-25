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
  const own = new Set(payments.filter(p => {
    const owner = owners.get(p.stripe_payment_intent);
    return owner?.payer_member_id === memberId && owner.split_id === null;
  }).map(p => p.order_id));
  const missing = orderIds.filter(id => !own.has(id));
  if (missing.length) for (const id of await paidWholeBillOrderIds(db, restaurantId, sessionId, memberId, missing)) own.add(id);
  return own;
}

/**
 * An order on the bill with nothing left to charge gets no payments row, yet
 * it was on the page this member paid. It is theirs too, so one empty order
 * does not refuse the whole receipt.
 */
async function paidWholeBillOrderIds(
  db: Database, restaurantId: string, sessionId: string, memberId: string, orderIds: string[],
): Promise<string[]> {
  const { data: pages, error } = await db.from("diner_checkouts").select("payable_order_ids")
    .eq("restaurant_id", restaurantId).eq("status", "paid").eq("payer_member_id", memberId)
    .is("split_id", null).overlaps("payable_order_ids", orderIds);
  if (error) throw new Error("Could not read paid checkouts");
  const wanted = new Set(orderIds);
  const onPaidPages = [...new Set((pages ?? []).flatMap(p => (p.payable_order_ids ?? []) as string[]))].filter(id => wanted.has(id));
  if (!onPaidPages.length) return [];
  // A checkout row records no sitting; the order itself must be in this one.
  const { data: orders, error: orderError } = await db.from("orders").select("id")
    .eq("restaurant_id", restaurantId).eq("session_id", sessionId).in("id", onPaidPages);
  if (orderError) throw new Error("Could not read paid checkout orders");
  return (orders ?? []).map(o => o.id);
}
