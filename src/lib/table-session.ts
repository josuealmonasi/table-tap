import { createAdminClient } from "@/lib/supabase/admin";
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
 * The table's open sitting, without starting one.
 *
 * Reading a menu must not open a sitting: a diner who scans the QR, looks at
 * the prices and walks out has not sat down, and a table that marked itself
 * occupied because somebody glanced at it would need clearing by hand.
 *
 * A sitting older than the longest plausible one is treated as gone even if
 * nobody has closed it yet — the same rule `open_table_session` applies when
 * the next party orders.
 */
export async function currentSessionId(
  restaurantId: string,
  tableId: string,
): Promise<string | null> {
  const cutoff = new Date(Date.now() - OPEN_BILL_HOURS * 60 * 60 * 1000).toISOString();
  const db = createAdminClient();
  const { data } = await db
    .from("table_sessions")
    .select("id, opened_at")
    .eq("restaurant_id", restaurantId)
    .eq("table_id", tableId)
    .is("closed_at", null)
    .maybeSingle();

  const session = data as { id: string; opened_at: string } | null;
  if (!session) return null;

  // Vencida: se cierra aquí en lugar de ignorarla. Dejarla abierta pero
  // invisible es lo que hacía que el piso viera una cuenta de MX$91.85 que el
  // comensal no podía ni ver ni pagar — la misma fila decía dos cosas según
  // quién preguntara. La deuda sigue en las cuentas abiertas del gerente.
  if (session.opened_at < cutoff) {
    await db
      .from("table_sessions")
      .update({ closed_at: new Date().toISOString(), close_reason: "expired" })
      .eq("id", session.id)
      .is("closed_at", null);
    return null;
  }

  return session.id;
}

/**
 * Confirms a phone's sitting really is this table's, and still open.
 *
 * The id comes from the diner's own device, so it is checked rather than
 * trusted: an id for another table — or one already closed — buys nothing.
 */
export async function sessionAtTable(
  sessionId: string,
  tableId: string,
): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("table_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("table_id", tableId)
    .is("closed_at", null)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Opens the table's sitting, or joins the one already open. */
export async function openSession(
  restaurantId: string,
  tableId: string,
): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("open_table_session", {
    p_restaurant: restaurantId,
    p_table: tableId,
    p_max_hours: OPEN_BILL_HOURS,
  });
  if (error) return null;
  return (data as string) ?? null;
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
  await createAdminClient().rpc("close_session_if_clear", {
    p_session: sessionId,
    p_reason: reason,
  });
}

/** Closes whatever sittings the given orders belonged to, if they are clear. */
export async function closeSessionsFor(
  orders: { session_id?: string | null }[],
  reason: "paid" | "settled" | "written_off",
): Promise<void> {
  const ids = [...new Set(orders.map(o => o.session_id).filter(Boolean))] as string[];
  await Promise.all(ids.map(id => closeSessionIfClear(id, reason)));
}
