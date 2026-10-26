import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingStaff } from "@/lib/api-guard";
import { MOVES_ORDERS } from "@/lib/membership";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// POST /api/orders/station — one station has finished its part of an order.
//
// { id, station: "kitchen" | "bar" }
//
// The people who move orders on the board (not the floor). The database does
// the rest under the order's lock: it records the station, and moves the
// order to ready once every station it needs has finished — the bar and the
// kitchen finishing in the same second both count.
export async function POST(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor || !MOVES_ORDERS(actor.role)) return await apiError("apiErr.notYourStage", 403);
  const body = await jsonBody<{ id?: unknown; station?: unknown }>(req);
  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  const station = body?.station === "kitchen" || body?.station === "bar" ? body.station : null;
  if (!id || !station) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();
  let orderId = id;
  if (actor.role === "kitchen") {
    // A ticket id must never double as a credential for the public diner bill.
    const { data: order, error } = await db.from("orders").select("id")
      .eq("kitchen_ticket_id", id).eq("restaurant_id", actor.restaurantId).maybeSingle();
    if (error) return await apiError("apiErr.orderData", 500);
    if (!order) return await apiError("apiErr.orderNotFound", 404);
    orderId = order.id;
  }
  const { data, error } = await db.rpc("mark_station_ready", {
    p_restaurant: actor.restaurantId,
    p_order: orderId,
    p_station: station,
  });
  if (error) return await apiError("apiErr.orderData", 500);
  const result = data as { outcome: string; status?: string; stations_ready?: string[] };
  if (result.outcome === "missing") return await apiError("apiErr.orderNotFound", 404);
  if (result.outcome === "inactive" || (result.outcome === "moved" &&
      ["cancelled", "completed", "pending_payment"].includes(result.status ?? ""))) {
    return await apiError("apiErr.orderInactive", 409, undefined, { inactive: true });
  }
  if (result.outcome === "moved") return await apiError("apiErr.orderMovedOn", 409);
  if (result.outcome === "notHere") return await apiError("apiErr.stationNotInOrder", 409);
  if (result.outcome !== "ok") return await apiError("apiErr.invalidRequest", 400);
  return NextResponse.json({ ok: true, status: result.status, stationsReady: result.stations_ready });
}
