import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { MOVES_ORDERS } from "@/lib/membership";
import { actingStaff } from "@/lib/api-guard";
import { canMoveOrder } from "@/lib/order-flow";

export const runtime = "nodejs";

// PATCH /api/orders — move an order along the board. Staff of its own
// restaurant only, one stage at a time: the next stage or a step back, never a
// cancelled or written-off order, and never `pending_payment`, which only a
// payment moves. Cancelling has its own route, so a paid order is refunded.
export async function PATCH(req: NextRequest) {
  const body = await jsonBody<{ id?: string; status?: string; from?: string }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { id, status, from } = body;

  // "cancelled" is deliberately NOT here: cancelling must go through
  // /api/orders/cancel so a paid order is always refunded first.
  const allowed = ["received", "preparing", "ready", "completed"];
  if (!id || !status || !allowed.includes(status) || (from !== undefined && typeof from !== "string")) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  // A waiter may only close out an order they're handing over. Every other
  // stage change belongs to the kitchen, and the UI hiding the control is not
  // enforcement — this is.
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  if (!MOVES_ORDERS(actor.role) && status !== "completed") {
    return await apiError("apiErr.notYourStage", 403);
  }

  // The kitchen cannot SELECT orders. Resolve its separate ticket id on the
  // server, confined to the actor's restaurant. Seeing a ticket is not enough
  // to move it — the move must be one the board itself would offer.
  const readOrder = () => createAdminClient()
    .from("orders")
    .select("id, status, written_off")
    .eq(actor.role === "kitchen" ? "kitchen_ticket_id" : "id", id)
    .eq("restaurant_id", actor.restaurantId)
    .maybeSingle();
  const { data: order, error: readError } = await readOrder();
  if (readError) return await apiError("apiErr.orderData", 500);
  if (!order) return await apiError("apiErr.forbidden", 403);

  if (order.written_off || ["cancelled", "completed", "pending_payment"].includes(order.status)) {
    return await apiError("apiErr.orderInactive", 409, undefined, { inactive: true });
  }
  if ((from !== undefined && from !== order.status) ||
      !canMoveOrder(order.status, status, MOVES_ORDERS(actor.role))) {
    return await apiError("apiErr.orderMoveChanged", 409);
  }

  // Orders have no client UPDATE policy (writes are server-only), so the
  // write uses the secret key, scoped to the actor's restaurant.
  //
  // Every move is a compare-and-set on the status just read, whether or not
  // the client sent `from`. A queued move flushed on reconnect must not drag
  // back an order the kitchen has already called ready — stale work quietly
  // beating live work, which is the whole risk of holding anything offline —
  // and a cancellation or write-off that wins the race must stay final.
  const { data: moved, error } = await createAdminClient()
    .from("orders").update({ status })
    .eq("id", order.id).eq("restaurant_id", actor.restaurantId)
    .eq("status", order.status).eq("written_off", false)
    .select("id");
  if (error) return await apiError("apiErr.orderData", 500);
  if (moved?.length !== 1) {
    // A write-off can win after the read. Retire the stale card without
    // changing its original status, even if its realtime event was missed.
    const { data: current, error: currentError } = await readOrder();
    if (currentError) return await apiError("apiErr.orderData", 500);
    if (current && (current.written_off || ["cancelled", "completed", "pending_payment"].includes(current.status))) {
      return await apiError("apiErr.orderInactive", 409, undefined, { inactive: true });
    }
    return await apiError("apiErr.orderMoveChanged", 409);
  }
  return NextResponse.json({ ok: true });
}
