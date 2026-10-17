import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MOVES_ORDERS } from "@/lib/membership";
import { actingStaff } from "@/lib/api-guard";
import { canMoveOrder } from "@/lib/order-flow";

export const runtime = "nodejs";

// Ordinary board moves never release a checkout or reopen a terminal order.
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

  // Every move compares the current status, including older clients without
  // `from`. A cancellation or write-off that wins this race must stay final.
  const { data: moved, error } = await createAdminClient()
    .from("orders").update({ status })
    .eq("id", id).eq("restaurant_id", actor.restaurantId)
    .eq("status", order.status).eq("written_off", false)
    .select("id");
  if (error) return await apiError("apiErr.orderData", 500);
  if (moved?.length !== 1) return await apiError("apiErr.orderMoveChanged", 409);
  return NextResponse.json({ ok: true });
}
