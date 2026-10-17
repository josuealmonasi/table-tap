import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createClient } from "@/lib/supabase/server";
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

  const supabase = await createClient();

  // A waiter may only close out an order they're handing over. Every other
  // stage change belongs to the kitchen, and the UI hiding the control is not
  // enforcement — this is.
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  if (!MOVES_ORDERS(actor.role) && status !== "completed") {
    return await apiError("apiErr.notYourStage", 403);
  }

  // Read through the staff session, so RLS is the first check: only the
  // restaurant's own team can SELECT an order. Seeing it is not enough to move
  // it any more — the move must be one the board itself would offer.
  const { data: order, error: readError } = await supabase
    .from("orders")
    .select("id, status, written_off")
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId)
    .maybeSingle();
  if (readError) return await apiError("apiErr.orderData", 500);
  if (!order) return await apiError("apiErr.forbidden", 403);

  if (order.written_off || (from !== undefined && from !== order.status) ||
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
    .eq("id", id).eq("restaurant_id", actor.restaurantId)
    .eq("status", order.status).eq("written_off", false)
    .select("id");
  if (error) return await apiError("apiErr.orderData", 500);
  if (moved?.length !== 1) return await apiError("apiErr.orderMoveChanged", 409);
  return NextResponse.json({ ok: true });
}
