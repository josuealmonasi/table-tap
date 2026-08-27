import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { closeSessionsFor } from "@/lib/table-session";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

export const runtime = "nodejs";

/** How the waiter took the money. */
type Settlement = "cash" | "card";

// POST /api/table-payment
// Body: { tableId, settlement }
//
// The waiter settles a table in person: cash, or a card on their own terminal.
//
// Cancelling a debt used to live here too, which meant any waiter could erase
// a bill with one tap and leave no reason behind. That moved to
// /api/bill/write-off, where it needs a reason and — for a waiter — a
// manager's approval.
//
// Front of house only — owner, manager or waiter — and scoped to the caller's
// own restaurant. This marks money as received without any money moving
// through us, so it must not be reachable from a customer's phone, nor from a
// kitchen screen that everyone in the back has their hands on.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { tableId, orderId, settlement } = (await req.json()) as {
    tableId?: string;
    orderId?: string;
    settlement?: Settlement;
  };
  // A table or a counter order, never both and never neither: if both arrived
  // we would have to decide which wins, and guessing which to charge is the
  // last thing an endpoint marking money as received should do.
  if (!["cash", "card"].includes(settlement ?? "") || Boolean(tableId) === Boolean(orderId)) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const db = createAdminClient();

  // Scoped by the actor's restaurant, so a table id from elsewhere matches
  // nothing. Only what is genuinely outstanding is touched: an order already
  // paid must not be quietly rewritten.
  const scoped = db
    .from("orders")
    .update({ paid: true, pay_method: settlement })
    .eq("restaurant_id", actor.restaurantId);

  // A general-QR order is collected on its own, and only if it has no table:
  // without that, this id could settle one loose order from a table and leave
  // the bill half done with nobody seeing it.
  const base = (tableId ? scoped.eq("table_id", tableId) : scoped.eq("id", orderId!).is("table_id", null))
    .eq("paid", false)
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .neq("status", "cancelled");

  const { data: updated, error } = await base.select("id, table_label, total, session_id");
  if (error) return await apiError("apiErr.orderData", 500);
  if (!updated?.length) return await apiError("apiErr.nothingToSettle", 409);

  // Money moved without a card, so it is worth being able to ask about later.
  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "bill",
    action: "paid",
    detail: logDetail({
      table: updated[0].table_label,
      orders: updated.length,
      amount: updated.reduce((sum, o) => sum + Number(o.total), 0).toFixed(2),
      method: settlement,
    }),
  });

  // Nothing owed on the sitting means the table is clear, and whoever was
  // bound to it is free to sit somewhere else.
  await closeSessionsFor(updated ?? [], "settled");

  // The table is settled, so any open request to settle it is answered.
  await db
    .from("service_requests")
    .update({ status: "done" })
    .eq("restaurant_id", actor.restaurantId)
    .eq("table_id", tableId)
    .eq("kind", "pay")
    .eq("status", "open");

  return NextResponse.json({ ok: true, orders: updated.length });
}
