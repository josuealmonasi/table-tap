import { createAdminClient } from "@/lib/supabase/admin";
import { round2 } from "@/lib/money";

/**
 * Switching the service charge off takes it off the bills still open.
 *
 * Every order stores the service charge it was priced with, so a restaurant
 * that turned it off still had it on every bill placed before: a MX$4.00 salad
 * was owed as MX$4.40 after the owner had said there was no service charge.
 * The owner's word applies to what nobody has started paying.
 *
 * It only ever lowers. Switching it on, or raising it, never adds to an order
 * already placed — the diner saw the price when they ordered, and a bill that
 * grows after the fact is a charge nobody agreed to.
 *
 * And it leaves alone every order whose total is already promised to someone:
 * paid, written off or cancelled; waiting for its own card payment; with money
 * already against it or its sitting; divided into shares; named in a discount
 * or write-off waiting for a manager; or in a card checkout opened in the last
 * `CHECKOUT_HOLD_MINUTES` — each of those was priced from the old total, and
 * changing it underneath them is how a ledger comes to disagree with Stripe.
 */

/** A bill's Stripe session expires after 30 minutes; five more for the webhook. */
export const CHECKOUT_HOLD_MINUTES = 35;

interface Priced {
  subtotal: number;
  service_fee: number;
  total: number;
}

/**
 * An order's service charge and total at `servicePct`, or null when that would
 * not lower it. The charge is taken on the discounted subtotal, the way the
 * cart and checkout take it (`priceCart`).
 */
export function repricedService(order: Priced, servicePct: number): { service_fee: number; total: number } | null {
  const current = Number(order.service_fee) || 0;
  const wanted = round2(Number(order.subtotal) * (Math.max(0, servicePct) / 100));
  if (wanted >= current) return null;
  return { service_fee: wanted, total: round2(Number(order.total) - current + wanted) };
}

interface OpenOrder extends Priced {
  id: string;
  session_id: string | null;
  card_checkout_at: string | null;
}

/**
 * Lowers the service charge on the restaurant's open bills to `servicePct`.
 * Returns how many orders changed, or null when it could not tell — the
 * caller says so rather than leaving the owner believing it was done.
 */
export async function repriceOpenService(restaurantId: string, servicePct: number): Promise<number | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("orders")
    .select("id, subtotal, service_fee, total, session_id, card_checkout_at")
    .eq("restaurant_id", restaurantId)
    .eq("paid", false)
    .is("account_id", null)
    .eq("written_off", false)
    .not("status", "in", "(cancelled,pending_payment)")
    .is("stripe_session_id", null)
    .gt("service_fee", 0);
  if (error) {
    console.error("repricing open bills: could not read them", error.message);
    return null;
  }
  const candidates = ((data ?? []) as OpenOrder[]).filter(o => repricedService(o, servicePct) !== null);
  if (candidates.length === 0) return 0;

  const ids = candidates.map(o => o.id);
  const sittings = [...new Set(candidates.map(o => o.session_id).filter((s): s is string => Boolean(s)))];
  const [byOrder, bySitting, splits, discounts, writeOffs] = await Promise.all([
    db.from("payments").select("order_id").in("order_id", ids),
    sittings.length
      ? db.from("payments").select("session_id").in("session_id", sittings)
      : Promise.resolve({ data: [], error: null }),
    sittings.length
      ? db.from("bill_splits").select("session_id").in("session_id", sittings).in("status", ["proposed", "locked"])
      : Promise.resolve({ data: [], error: null }),
    db.from("discount_requests").select("order_ids").eq("restaurant_id", restaurantId).eq("status", "pending"),
    db.from("write_off_requests").select("order_ids").eq("restaurant_id", restaurantId).eq("status", "pending"),
  ]);
  const failed = byOrder.error ?? bySitting.error ?? splits.error ?? discounts.error ?? writeOffs.error;
  if (failed) {
    console.error("repricing open bills: could not tell which are already promised", failed.message);
    return null;
  }

  const paidOrders = new Set(((byOrder.data ?? []) as { order_id: string | null }[]).map(p => p.order_id));
  const busySittings = new Set([
    ...((bySitting.data ?? []) as { session_id: string | null }[]).map(p => p.session_id),
    ...((splits.data ?? []) as { session_id: string | null }[]).map(s => s.session_id),
  ]);
  const requested = new Set(
    [...((discounts.data ?? []) as { order_ids: string[] }[]), ...((writeOffs.data ?? []) as { order_ids: string[] }[])]
      .flatMap(r => r.order_ids ?? []),
  );
  const holdSince = Date.now() - CHECKOUT_HOLD_MINUTES * 60 * 1000;

  let changed = 0;
  for (const order of candidates) {
    if (paidOrders.has(order.id) || requested.has(order.id)) continue;
    if (order.session_id && busySittings.has(order.session_id)) continue;
    if (order.card_checkout_at && new Date(order.card_checkout_at).getTime() > holdSince) continue;
    const next = repricedService(order, servicePct)!;
    // Guarded on what was read: an order paid, or repriced by somebody else,
    // in the moment between is left as it now is.
    const { data: done, error: writeError } = await db
      .from("orders")
      .update(next)
      .eq("id", order.id)
      .eq("restaurant_id", restaurantId)
      .eq("paid", false)
      .is("account_id", null)
      .eq("service_fee", order.service_fee)
      .select("id");
    if (writeError) {
      console.error("repricing open bills: could not lower one", writeError.message);
      return null;
    }
    changed += done?.length ?? 0;
  }
  return changed;
}
