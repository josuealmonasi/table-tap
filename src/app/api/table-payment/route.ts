import { checkoutPageRpc } from "@/lib/checkout-page-rpc";
import { PaymentAttributionRequired } from "@/lib/payment-coverage";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { closeSessionsFor } from "@/lib/table-session";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { settleReviewedTable } from "@/lib/settle-reviewed-table";

export const runtime = "nodejs";

/** How the waiter took the money. */
type Settlement = "cash" | "card";

// POST /api/table-payment
// Body: { tableId, settlement, expected, currency, ref } for a table, or
// { orderId, settlement, currency } for a counter order.
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
  try { return await collect(req); }
  catch (error) {
    if (error instanceof PaymentAttributionRequired) return await apiError("apiErr.attributionRequired", 409);
    throw error;
  }
}

async function collect(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{
    tableId?: string;
    orderId?: string;
    settlement?: Settlement;
    expected?: number;
    currency?: string;
    ref?: string;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { tableId, orderId, settlement } = body;
  // A table or a counter order, never both and never neither: if both arrived
  // we would have to decide which wins, and guessing which to charge is the
  // last thing an endpoint marking money as received should do.
  if (!["cash", "card"].includes(settlement ?? "") || Boolean(tableId) === Boolean(orderId)) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  // A table is collected only against the balance its screen showed. Without
  // that figure (a tab opened before the reviewed balance shipped) this used
  // to record whatever the table owed when the request landed: a waiter
  // holding MX$100 while another added MX$50 cleared a MX$150 bill, and MX$50
  // of recorded cash never arrived (audit L, finding 1). Refusing records
  // nothing and says how to collect; the refreshed screen sends the figure.
  if (tableId && body.expected === undefined) return await apiError("apiErr.refreshToCollect", 409);
  if (tableId) return settleReviewedTable(actor, tableId, body, settlement!);

  // From here on it is a counter order, collected whole: nothing can be added
  // to it between the screen and this request, so its total is what was seen.
  const db = createAdminClient();

  // Scoped by the actor's restaurant, so an order id from elsewhere matches
  // nothing. Only what is genuinely outstanding is read: an order already
  // paid must not be quietly rewritten.
  const scoped = db
    .from("orders")
    .select("id, table_label, total, session_id")
    .eq("restaurant_id", actor.restaurantId);

  // A general-QR order is collected on its own, and only if it has no table:
  // without that, this id could settle one loose order from a table and leave
  // the bill half done with nobody seeing it.
  const base = scoped.eq("id", orderId!).is("table_id", null)
    .eq("paid", false)
    .is("account_id", null)
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .neq("status", "cancelled");

  const { data: updated, error } = await base;
  if (error) return await apiError("apiErr.orderData", 500);
  if (!updated?.length) return await apiError("apiErr.nothingToSettle", 409);

  // A counter order is never collected in parts, so it is recorded for what
  // it came to. Part payments and sittings belong to tables, which went
  // through the reviewed path above.
  const collectedNow = total(updated);

  // The orders and the ledger in one write (`settle_orders`): both, or
  // neither. They were two, and a failed second write left a bill marked paid
  // with no money behind it that no retry could repair.
  const { error: settleError } = await checkoutPageRpc("settle_orders_v2", {
    p_restaurant: actor.restaurantId,
    p_orders: updated.map(o => o.id),
    p_method: settlement,
    p_actor: actor.email,
    p_sittings: null,
  });
  if (settleError?.message === "paying") return await apiError("apiErr.accountBillPaying", 409);
  if (settleError?.message === "not_owed") return await apiError("apiErr.billChanged", 409);
  if (settleError) {
    console.error("settling a bill failed:", settleError.message);
    return await apiError("apiErr.orderData", 500);
  }

  // Money moved without a card, so it is worth being able to ask about later.
  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "bill",
    action: "paid",
    detail: logDetail({
      table: updated[0].table_label,
      orders: updated.length,
      amount: collectedNow.toFixed(2),
      method: settlement,
    }),
  });

  // Nothing owed on the sitting means whoever was bound to it is free to go.
  await closeSessionsFor(updated ?? [], "settled");

  return NextResponse.json({ ok: true, orders: updated.length });
}

/** What a set of orders came to, gratuities included — they were collected too. */
function total(orders: { total: number | string }[]): number {
  return Number(orders.reduce((sum, o) => sum + Number(o.total), 0).toFixed(2));
}
