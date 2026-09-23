// ============================================================================
// How often a diner's screen asks again.
//
// In one place because each of these is also how often its route is asked:
// the route sizes its limit from the same number (`forTheRoom` in
// rate-limit.ts), so a poll made faster here raises the limit with it instead
// of walking into it.
//
// Client-safe on purpose: the hooks import it, and rate-limit.ts holds the
// secret key.
// ============================================================================

/** The open order tracker, until the food is out. */
export const TRACKER_POLL_MS = 5_000;

/** The menu's "track my order" button, asking about each order it follows. */
export const ORDER_HEARTBEAT_MS = 15_000;

/** How many orders one phone follows at once, at most, in the ordinary case. */
export const ORDERS_FOLLOWED = 2;

/** A table dividing its bill, while the bill sheet is open. */
export const SPLIT_POLL_MS = 5_000;

/** The table's bill, while the diner is looking at it. */
export const BILL_POLL_MS = 10_000;

/** Asks a minute, for a screen polling every `ms`. */
export function perMinute(ms: number): number {
  return Math.ceil(60_000 / ms);
}
