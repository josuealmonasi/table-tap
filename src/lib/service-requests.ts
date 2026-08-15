/**
 * How long a "call the waiter" or "bring the bill" tap stays on the board.
 *
 * Nothing closes a request the floor never answered, so they accumulated: the
 * board was showing taps from weeks earlier, one of them printed as "11495m
 * ago". A stale chip is worse than no chip — it teaches the floor that the row
 * is noise. Anyone still waiting taps again, which is one tap.
 */
export const STALE_REQUEST_HOURS = 8;
