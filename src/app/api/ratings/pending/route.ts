import { memberRatingOrders } from "@/lib/rating-membership";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { rateableDishes } from "@/lib/ratings";
import type { OrderLineItem } from "@/lib/types";

/**
 * What this device is entitled to rate.
 *
 * The browser sends the order ids it remembers placing; this returns only the
 * dishes from those orders that are paid, belong to this restaurant, and
 * haven't been rated yet.
 *
 * Counter orders use the unguessable tracker id. Table orders additionally
 * require the approved member cookie and the member id stored on the order,
 * so reading another dish on a shared bill never grants permission to rate it.
 */
export async function POST(req: NextRequest) {
  if (await isRateLimited(`rating-pending:${clientKey(req)}`, 30, 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  const body = await jsonBody<{ restaurantId?: string; orderIds?: string[] }>(req);
  if (!body) return await apiError("apiErr.badRequest", 400);

  const { restaurantId, orderIds } = body;
  if (!restaurantId || !Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ dishes: [] });
  }

  const supabase = createAdminClient();
  const ids = [...new Set(orderIds.filter(id => typeof id === "string"))].slice(0, 20);

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, items, table_id, session_id, diner")
    .in("id", ids)
    .eq("restaurant_id", restaurantId)
    .eq("paid", true);

  if (error) {
    return await apiError("apiErr.ordersLoad", 503);
  }
  if (!orders?.length) return NextResponse.json({ dishes: [] });

  const owned = await memberRatingOrders(req, restaurantId, orders ?? []).catch(() => null);
  if (!owned) return await apiError("apiErr.verifyOrders", 503);

  // Already-rated pairs drop out, so re-asking after a partial submit only
  // offers what's left rather than starting over.
  const { data: rated } = await supabase
    .from("dish_ratings")
    .select("order_id, item_id")
    .in(
      "order_id",
      owned.map(o => o.id),
    );

  const dishes = rateableDishes(
    owned.map(o => ({ id: o.id, items: (o.items ?? []) as OrderLineItem[] })),
    (rated ?? []).map(r => ({ orderId: r.order_id, itemId: r.item_id })),
  );

  return NextResponse.json({ dishes });
}
