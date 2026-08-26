import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { rateableDishes } from "@/lib/ratings";
import type { OrderLineItem } from "@/lib/types";

/**
 * What this device is entitled to rate.
 *
 * The browser sends the order ids it remembers placing; this returns only the
 * dishes from those orders that are paid, belong to this restaurant, and
 * haven't been rated yet.
 *
 * What guards it is that an order id is an unguessable uuid — the same trust
 * boundary as the tracker link, which shows the order to anyone holding it.
 * Whoever has the id already knows what was ordered. It does NOT check that
 * this device is the one that placed the order, and the comment here used to
 * claim it did.
 */
export async function POST(req: NextRequest) {
  if (await isRateLimited(`rating-pending:${clientIp(req)}`, 30, 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  let body: { restaurantId?: string; orderIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return await apiError("apiErr.badRequest", 400);
  }

  const { restaurantId, orderIds } = body;
  if (!restaurantId || !Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ dishes: [] });
  }

  const supabase = createAdminClient();
  const ids = [...new Set(orderIds.filter(id => typeof id === "string"))].slice(0, 20);

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, items")
    .in("id", ids)
    .eq("restaurant_id", restaurantId)
    .eq("paid", true);

  if (error) {
    return await apiError("apiErr.ordersLoad", 503);
  }
  if (!orders?.length) return NextResponse.json({ dishes: [] });

  // Already-rated pairs drop out, so re-asking after a partial submit only
  // offers what's left rather than starting over.
  const { data: rated } = await supabase
    .from("dish_ratings")
    .select("order_id, item_id")
    .in(
      "order_id",
      orders.map(o => o.id),
    );

  const dishes = rateableDishes(
    orders.map(o => ({ id: o.id, items: (o.items ?? []) as OrderLineItem[] })),
    (rated ?? []).map(r => ({ orderId: r.order_id, itemId: r.item_id })),
  );

  return NextResponse.json({ dishes });
}
