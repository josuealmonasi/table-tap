import { MARK } from "../api-fixtures.mjs";

// The pass holds a ticket id, never the diner's order lookup credential.
export async function kitchenTicketId(f, orderId) {
  const { data, error } = await f.admin.from("orders").select("kitchen_ticket_id")
    .eq("id", orderId).eq("restaurant_id", f.restaurant.id).single();
  if (error || !data?.kitchen_ticket_id) throw new Error(`no kitchen ticket: ${error?.message ?? orderId}`);
  return data.kitchen_ticket_id;
}

export async function returnFor(f, orderId) {
  const { data, error } = await f.admin.from("refund_operations")
    .select("id, amount, source, status, confirmed_by, payout_actor, order_adjustments!inner(order_id)")
    .eq("restaurant_id", f.restaurant.id).eq("order_adjustments.order_id", orderId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Creating a coupon answers `{ ok: true }`, so the id is looked up where it lives. */
export async function pendingWriteOff(fx) {
  const { data } = await fx.admin
    .from("write_off_requests").select("id")
    .eq("restaurant_id", fx.restaurant.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? "";
}

export async function pendingDiscount(fx) {
  const { data } = await fx.admin
    .from("discount_requests").select("id")
    .eq("restaurant_id", fx.restaurant.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? "";
}

export async function promoId(fx) {
  const { data } = await fx.admin
    .from("promotions").select("id")
    .eq("restaurant_id", fx.restaurant.id).like("name", `${MARK}%`)
    .limit(1).maybeSingle();
  return data?.id ?? "";
}

/**
 * Any order of this restaurant's — the print route only needs one to exist.
 *
 * Remembered on the fixture, because a reprint queues a job against an order
 * the seed made: deleting the orders this run created leaves that job sitting
 * in the queue, and teardown has no other way to find it.
 */
export async function anyOrderId(fx) {
  const { data } = await fx.admin
    .from("orders").select("id").eq("restaurant_id", fx.restaurant.id).limit(1).maybeSingle();
  if (data?.id) (fx.printedOrders ??= []).push(data.id);
  return data?.id ?? "";
}

export async function dietaryTagId(fx) {
  const { data } = await fx.admin
    .from("dietary_tags").select("id").eq("restaurant_id", fx.restaurant.id)
    .eq("key", `${MARK}_diet`).maybeSingle();
  return data?.id ?? "";
}

export async function iconGroupId(fx) {
  const { data } = await fx.admin
    .from("icon_groups").select("id").eq("restaurant_id", fx.restaurant.id)
    .eq("name", `${MARK} icons`).maybeSingle();
  return data?.id ?? "";
}

export async function couponId(fx) {
  const { data } = await fx.admin
    .from("coupons").select("id").eq("restaurant_id", fx.restaurant.id)
    .eq("code", "API-001").maybeSingle();
  return data?.id ?? "";
}

/** A documentation address (TEST-NET-3), standing in for a restaurant's Wi-Fi. */
export const ROOM_ADDRESS = "203.0.113.30";
