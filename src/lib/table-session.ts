import { createAdminClient } from "@/lib/supabase/admin";
import { endSplitsFor } from "@/lib/split-service";
import { OPEN_BILL_HOURS } from "@/lib/table-bill";

/**
 * A sitting: one party at one table, from their first order until the table is
 * clear again.
 *
 * This is what a bill belongs to. Asking "what has this table ordered lately"
 * was always a guess — it showed the floor a debt the diner could not pay, and
 * it could not tell one party from the next. A session answers exactly: the
 * bill is the orders in the sitting that is open right now, and a party that
 * has settled leaves nothing behind for the next one to be shown.
 */

/**
 * Opens the table's sitting, or joins the one already open.
 *
 * @param openedBy a member of staff, when it is staff opening the bill. It is
 * recorded only if this call CREATES the sitting: a waiter bringing a round to
 * a table that opened its own bill has not taken it over, and the diners keep
 * the card field they have been using all evening.
 */
export async function openSession(
  restaurantId: string,
  tableId: string,
  openedBy?: string | null,
): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("open_table_session", {
    p_restaurant: restaurantId,
    p_table: tableId,
    p_max_hours: OPEN_BILL_HOURS,
    p_opened_by: openedBy ?? null,
  });
  if (error) return null;
  return (data as string) ?? null;
}

/**
 * Is this table's bill being settled by a member of staff in person?
 *
 * The one question every route that charges a card has to ask about a table
 * before charging it. A waiter who seated the party and took their order is
 * standing there with the machine and a running balance; a diner paying online
 * at the same moment pays for food the waiter is about to collect for.
 *
 * Asked of the sittings the table's UNPAID orders belong to — which is exactly
 * the set those routes would charge for. Asking only about the sitting that is
 * open right now was too narrow: a waiter's bill whose sitting had closed with
 * something still owed on it became payable online again, and the debt that is
 * most obviously the waiter's to collect is the one nobody is sitting at.
 *
 * Answered from the sitting rather than from the screen, because the screen is
 * not a guard: it hides a button, and a request can be made without one.
 */
export async function staffOpenedBill(
  restaurantId: string,
  tableId: string,
  sessionId?: string,
): Promise<boolean> {
  const db = createAdminClient();
  let owedQuery = db
    .from("orders")
    .select("session_id")
    .eq("restaurant_id", restaurantId)
    .eq("table_id", tableId)
    .eq("paid", false)
    .is("account_id", null)
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .neq("status", "cancelled");
  if (sessionId) owedQuery = owedQuery.eq("session_id", sessionId);
  const { data: owed, error: owedError } = await owedQuery;
  // Thrown, never "no": this is the guard that stops a card being charged
  // while a waiter collects the same food, and a failed read answered false.
  if (owedError) throw new Error(`Could not read the table's orders: ${owedError.message}`);

  const sessions = [...new Set((owed ?? []).map(o => o.session_id).filter(Boolean))] as string[];
  if (sessions.length === 0) return false;

  const { count, error: countError } = await db
    .from("table_sessions")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .in("id", sessions)
    .not("opened_by", "is", null);
  if (countError) throw new Error(`Could not read the table's sittings: ${countError.message}`);
  return (count ?? 0) > 0;
}

/**
 * Closes the sitting if nothing on it is owed any more.
 *
 * Called after every way money stops being outstanding, rather than at one
 * chokepoint, because there is no single one: a card, cash at the table, and a
 * debt written off are three different routes to the same empty table.
 */
export async function closeSessionIfClear(
  sessionId: string | null | undefined,
  reason: "paid" | "settled" | "written_off",
): Promise<void> {
  if (!sessionId) return;
  const db = createAdminClient();
  await db.rpc("close_session_if_clear", { p_session: sessionId, p_reason: reason });

  // If that closed it, nothing is owed on this sitting any more — so a
  // division of it is over too, however it was going. Left locked, the shares
  // stay chargeable: `/api/split/pay` bills the amount frozen at the lock and
  // has no idea the waiter has already taken the cash.
  const { data: after } = await db
    .from("table_sessions").select("closed_at").eq("id", sessionId).maybeSingle();
  if (after?.closed_at) await endSplitsFor(sessionId);
}

/** Closes whatever sittings the given orders belonged to, if they are clear. */
export async function closeSessionsFor(
  orders: { session_id?: string | null }[],
  reason: "paid" | "settled" | "written_off",
): Promise<void> {
  const ids = [...new Set(orders.map(o => o.session_id).filter(Boolean))] as string[];
  await Promise.all(ids.map(id => closeSessionIfClear(id, reason)));
}
