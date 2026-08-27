import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import {
  acceptableRatings,
  isStorableId,
  rateableDishes,
  type SubmittedRating,
} from "@/lib/ratings";
import type { OrderLineItem } from "@/lib/types";

/**
 * Records dish ratings.
 *
 * The gate is proof of purchase, and it is checked here rather than trusted
 * from the client: every rating must name an order that is PAID, belongs to
 * this restaurant, and actually contains that dish. The browser sends order ids
 * it remembers placing, but those ids buy nothing on their own — they're only
 * a claim, and this route re-reads each order before believing it.
 *
 * Anything unverifiable is dropped rather than rejecting the whole batch: one
 * forged line shouldn't cost the honest ratings submitted alongside it.
 */
export async function POST(req: NextRequest) {
  // A rating is cheap to send and permanent once stored, so cap the rate.
  if (await isRateLimited(`rating:${clientIp(req)}`, 20, 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  let body: { restaurantId?: string; ratings?: SubmittedRating[] };
  try {
    body = await req.json();
  } catch {
    return await apiError("apiErr.badRequest", 400);
  }

  const { restaurantId, ratings } = body;
  if (!restaurantId || !Array.isArray(ratings) || ratings.length === 0) {
    return await apiError("apiErr.badRequest", 400);
  }

  const orderIds = [...new Set(ratings.map(r => r.orderId).filter(Boolean))];
  if (orderIds.length === 0 || orderIds.length > 20) {
    return await apiError("apiErr.badRequest", 400);
  }

  const supabase = createAdminClient();

  // The authority. Only paid orders, only this restaurant — an id from another
  // restaurant or an abandoned checkout entitles nobody to anything.
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, items")
    .in("id", orderIds)
    .eq("restaurant_id", restaurantId)
    .eq("paid", true);

  if (error) {
    return await apiError("apiErr.verifyOrders", 503);
  }

  const entitled = rateableDishes(
    (orders ?? []).map(o => ({ id: o.id, items: (o.items ?? []) as OrderLineItem[] })),
  );
  // And that the ids fit their columns. A line with an id that is not a uuid
  // passed the purchase check and blew up on the insert, and the 503 took the
  // honest ratings in the same submission down with it.
  const accepted = acceptableRatings(ratings, entitled).filter(
    r => isStorableId(r.itemId) && isStorableId(r.orderId),
  );
  if (accepted.length === 0) {
    return NextResponse.json({ saved: 0 });
  }

  // upsert on (order_id, item_id): re-rating a dish from the same order edits
  // the score rather than failing, which is what someone tapping a different
  // star expects. The unique constraint still caps it at one row per pair.
  const { error: insertError } = await supabase.from("dish_ratings").upsert(
    accepted.map(r => ({
      restaurant_id: restaurantId,
      item_id: r.itemId,
      order_id: r.orderId,
      rating: r.rating,
    })),
    { onConflict: "order_id,item_id" },
  );

  if (insertError) {
    return await apiError("apiErr.ratingsSave", 503);
  }
  return NextResponse.json({ saved: accepted.length });
}
