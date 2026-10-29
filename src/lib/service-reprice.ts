import { createAdminClient } from "@/lib/supabase/admin";

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
 * or write-off waiting for a manager; or in an unresolved card checkout at
 * any age — each of those was priced from the old total, and
 * changing it underneath them is how a ledger comes to disagree with Stripe.
 *
 * All of that is decided in `reprice_open_service`, under the money lock
 * (paths audit #4). Reading here and writing after let a collection land in
 * between, and the stale write lowered a total with money already against it.
 */

/** Stripe expires the page after 30 minutes; only its confirmed result can free the quote. */

/**
 * Lowers the service charge on the restaurant's open bills to `servicePct`.
 * Returns how many orders changed, or null when it could not tell — the
 * caller says so rather than leaving the owner believing it was done.
 */
export async function repriceOpenService(restaurantId: string, servicePct: number): Promise<number | null> {
  const { data, error } = await createAdminClient().rpc("reprice_open_service", {
    p_restaurant: restaurantId,
    p_pct: servicePct,
  });
  if (error) {
    console.error("repricing open bills:", error.message);
    return null;
  }
  return Number(data ?? 0);
}
