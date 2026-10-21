import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tableMember, type TableMember } from "@/lib/table-membership";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Phones that ordered before credentials shipped must still be able to pay.
 * Their existing private order links grant only those legacy orders, never
 * the shared bill or permission to order, split, approve or claim a card.
 */
export async function ownBillAccess(
  req: NextRequest, restaurantId: string, tableId: string,
  sessionId?: string | null, ownIds: string[] = [],
): Promise<TableMember | null> {
  const member = await tableMember(req, restaurantId, tableId, sessionId, true);
  if (member) return member;
  const ids = [...new Set(ownIds.filter(id => typeof id === "string" && UUID.test(id)))].slice(0, 200);
  if (!ids.length) return null;
  const db = createAdminClient();
  let query = db.from("orders").select("id, session_id, diner, paid, written_off, status, created_at")
    .eq("restaurant_id", restaurantId).eq("table_id", tableId).in("id", ids)
    .order("created_at", { ascending: false });
  if (sessionId) query = query.eq("session_id", sessionId);
  const { data: orders, error } = await query;
  if (error) throw new Error("Could not check legacy orders");
  if (!orders?.length) return null;
  // A regular's remembered orders span visits. An older paid meal must not
  // hide food still owed on a later one when the binding has been cleared.
  const owing = orders.filter(order => !order.paid && !order.written_off &&
    order.status !== "cancelled" && order.status !== "pending_payment");
  const candidates = owing.length ? owing : orders;
  // A closed sitting may have been forgotten by the phone's table binding.
  // Its private order links can find it again, but still need its credential
  // and still expose only that member's food after closure.
  for (const sitting of [...new Set(candidates.map(order => order.session_id).filter(Boolean))]) {
    const ownMember = await tableMember(req, restaurantId, tableId, sitting, true);
    if (ownMember) return ownMember;
  }
  const diners = [...new Set(orders.map(o => o.diner).filter((id): id is string => typeof id === "string" && UUID.test(id)))];
  const registered = new Set<string>();
  if (diners.length) {
    const { data, error: memberError } = await db.from("table_session_members").select("id").in("id", diners);
    if (memberError) throw new Error("Could not check legacy membership");
    for (const row of data ?? []) registered.add(row.id);
  }
  const legacy = candidates.filter(order => order.session_id && !registered.has(order.diner));
  // One sitting at a time, so neither the display nor its settlement guards
  // accidentally describe two parties as one bill.
  const sitting = sessionId ?? legacy[0]?.session_id;
  const own = legacy.filter(order => order.session_id === sitting).map(order => order.id);
  if (!sitting || !own.length) return null;
  return { id: "", sessionId: sitting, restaurantId, tableId, closed: true, legacyOrderIds: own };
}
