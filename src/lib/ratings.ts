import type { OrderLineItem } from "@/lib/types";

/**
 * Below this many ratings a dish is treated as unrated.
 *
 * One 5-star rating rendered as "5.0 ★" reads as a track record and isn't one;
 * it's also trivially gameable by a restaurant ordering from its own table
 * once. Mirrored in the `dish_rating_stats` SQL function — change both.
 */
export const MIN_RATINGS_TO_SHOW = 3;

export interface RateableDish {
  itemId: string;
  orderId: string;
  name: string;
  emoji: string;
}

export interface SubmittedRating {
  itemId: string;
  orderId: string;
  rating: number;
}

/** A whole number 1–5. Anything else is a forged or fat-fingered payload. */
export function isValidRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * The distinct dishes a set of orders entitles someone to rate.
 *
 * Deduped by dish rather than by line: two lines of the same dish in one order
 * (different modifiers, say) is still one opinion, and the unique constraint on
 * (order_id, item_id) would reject the second anyway. Combos are skipped —
 * a bundle isn't a dish, and its components were never individually chosen.
 */
export function rateableDishes(
  orders: { id: string; items: OrderLineItem[] }[],
  alreadyRated: { orderId: string; itemId: string }[] = [],
): RateableDish[] {
  const done = new Set(alreadyRated.map(r => `${r.orderId}:${r.itemId}`));
  const seen = new Set<string>();
  const out: RateableDish[] = [];

  for (const order of orders) {
    for (const line of order.items ?? []) {
      if (line.comboId) continue;
      const key = `${order.id}:${line.itemId}`;
      if (seen.has(key) || done.has(key)) continue;
      seen.add(key);
      out.push({
        itemId: line.itemId,
        orderId: order.id,
        name: line.name,
        emoji: line.emoji,
      });
    }
  }
  return out;
}

/**
 * Keeps only the ratings that name a dish the customer actually bought.
 *
 * The server runs this against orders re-read from the database, so a payload
 * naming someone else's order, an unpaid one, or a dish that wasn't in it is
 * dropped rather than trusted. Returning the survivors instead of throwing
 * means one bad line doesn't lose the honest ones alongside it.
 */
export function acceptableRatings(
  submitted: SubmittedRating[],
  entitled: RateableDish[],
): SubmittedRating[] {
  const allowed = new Set(entitled.map(d => `${d.orderId}:${d.itemId}`));
  const used = new Set<string>();
  return submitted.filter(r => {
    const key = `${r.orderId}:${r.itemId}`;
    if (!allowed.has(key) || used.has(key) || !isValidRating(r.rating)) return false;
    used.add(key);
    return true;
  });
}
