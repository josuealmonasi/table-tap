import { createAdminClient } from "@/lib/supabase/admin";
import { currentSessionId as openTableSession, sessionAtTable } from "@/lib/table-session";
import { unpaidOrders } from "@/lib/table-bill";
import type { Order } from "@/lib/types";

/**
 * What a table still owes, read server-side.
 *
 * Customers cannot read `orders` at all — the policy that let them was removed
 * as over-permissive — so this goes through the secret key and hands back only
 * the fields a diner needs to recognise their food and settle for it. Same
 * shape as the order tracker, for the same reason.
 *
 * For a diner this is the sitting they are part of, so the party sitting down
 * now is never shown — or asked to pay — what the last party left behind.
 * Staff see the lot.
 *
 * Anyone holding the table's URL can see what that table owes. The URL is
 * printed on the table, so this is the same trust boundary as the menu itself:
 * it tells you what the people sitting there ordered, which they can see
 * anyway.
 */

/** Only the columns the bill screen and the waiter's modal actually show. */
const FIELDS =
  "id, table_label, status, items, subtotal, discount, service_fee, tip, total, currency, paid, written_off, coupon_code, created_at";

export async function fetchTableBill(
  restaurantId: string,
  tableId: string,
  /**
   * Who is asking. A diner is shown this service only, so the party sitting
   * down now is never asked to pay for the last one. Staff are shown
   * everything owed, because they are the ones who have to collect it or
   * write it off — hiding a debt from the till is how the floor ends up
   * looking at a bill that says MX$105 while the app says nothing is owed.
   */
  audience: "diner" | "staff" = "diner",
  /**
   * The sitting this phone is part of, if it has one. Its own bill stays
   * payable however long it has been open — the diner who ordered it is the
   * one person who should never be told the table owes nothing.
   */
  sessionId?: string | null,
): Promise<Order[]> {
  let query = createAdminClient()
    .from("orders")
    .select(FIELDS)
    // Both, always: the table id alone would let one restaurant's id be paired
    // with another's table.
    .eq("restaurant_id", restaurantId)
    .eq("table_id", tableId)
    .eq("paid", false)
    // Written off: recorded as never paid, but no longer owed by anyone.
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .order("created_at", { ascending: true });

  if (audience === "diner") {
    // Their own sitting first: a phone that ordered here is owed a way to pay,
    // however long the table has been sitting. Otherwise the table's current
    // sitting, which is empty for a diner who has just scanned a table the
    // last party left a debt on — that debt is the manager's to resolve, and
    // showing it here would ask a stranger to pay it.
    const mine = sessionId ? await sessionAtTable(sessionId, tableId) : null;
    const session = mine ?? (await openTableSession(restaurantId, tableId));
    if (!session) return [];
    query = query.eq("session_id", session);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Could not load the table's bill: ${error.message}`);
  // `pending_payment` is already excluded above — those are carts mid-Stripe,
  // not debts. unpaidOrders drops cancelled ones.
  return unpaidOrders((data ?? []) as Order[]);
}

/**
 * What a single counter order owes.
 *
 * The QR that isn't a table produces orders with nobody sitting anywhere, so
 * there is no sitting to group them by: the order *is* the bill. Scoped to the
 * restaurant asking, so an id from another business finds nothing — the same
 * boundary a table id gets, and the only thing standing between one tenant's
 * cashier and another tenant's money.
 */
export async function fetchCounterBill(
  restaurantId: string,
  orderId: string,
): Promise<Order[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("orders")
    .select(FIELDS)
    .eq("restaurant_id", restaurantId)
    .eq("id", orderId)
    // Sin mesa: por aquí no se cobra media cuenta de una mesa.
    .is("table_id", null)
    .neq("status", "pending_payment");

  if (error) throw new Error(`Could not load the counter bill: ${error.message}`);
  return unpaidOrders((data ?? []) as Order[]);
}
