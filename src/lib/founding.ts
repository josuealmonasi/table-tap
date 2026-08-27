/**
 * The founding price.
 *
 * The first restaurants to subscribe keep the price they came in at. It is not
 * a discount: it is the same price, with the promise that it never rises —
 * which is what actually matters to a business budgeting in hundreds of pesos.
 * hundreds of pesos.
 *
 * It is also what makes the struck-through price honest. Today the list price
 * is a number nobody pays; once these places run out it becomes the real price
 * for whoever arrives next.
 */

/** How many places there are. Changing it here changes it everywhere. */
export const FOUNDING_SLOTS = 50;

/** Places left, never negative. */
export function slotsLeft(taken: number): number {
  return Math.max(0, FOUNDING_SLOTS - taken);
}

/** Can someone still come in as a founder? */
export function foundingOpen(taken: number): boolean {
  return slotsLeft(taken) > 0;
}

/**
 * The price paid by whoever subscribes right now.
 *
 * Computed, not stored. When place 50 fills the price rises by itself, with
 * nobody having to remember to edit the plans table — and if one day more
 * places are opened, moving FOUNDING_SLOTS brings the price back down. Editing
 * monthly_price by hand would have been irreversible and one more thing to
 * forget.
 *
 * It does not touch anyone already subscribed: Stripe does not re-price a live
 * subscription, and that is precisely the lock.
 */
export function currentPrice(
  limits: { monthly_price: number; list_price?: number | null },
  taken: number,
): number {
  if (foundingOpen(taken)) return limits.monthly_price;
  return limits.list_price ?? limits.monthly_price;
}

/**
 * What a founder saves in a year against the list price.
 *
 * The argument is not one month's saving: it is that the price never rises.
 */
export function yearlySaving(locked: number, list: number | null | undefined): number {
  if (!list || list <= locked) return 0;
  return (list - locked) * 12;
}
