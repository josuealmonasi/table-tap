// Remembers the customer's orders per restaurant, in localStorage, so they can
// leave the tracker to browse the menu and still get back to their order
// status — and so we know which dishes this device actually paid for.
//
// Order ids are unguessable and already live in the diner's own URL history,
// so keeping them on their device carries no extra risk. They are never proof
// on their own: the server re-reads every order before it acts on one.

const key = (restaurantId: string) => `tt-order:${restaurantId}`;
const listKey = (restaurantId: string) => `tt-orders:${restaurantId}`;

/** How many orders back we remember. A table session, not a lifetime. */
const MAX_REMEMBERED = 10;

/** Store this order as the restaurant's in-progress one for this device. */
export function rememberRecentOrder(restaurantId: string, orderId: string): void {
  try {
    localStorage.setItem(key(restaurantId), orderId);
    // Also append to the history. The single key above answers "what should
    // the track-order link point at"; this list answers "what has this device
    // bought", which is what the rating prompt is entitled to ask about.
    const seen = recallOrders(restaurantId).filter(id => id !== orderId);
    localStorage.setItem(
      listKey(restaurantId),
      JSON.stringify([orderId, ...seen].slice(0, MAX_REMEMBERED)),
    );
  } catch {
    // Private mode / storage disabled — the tracker link is a nice-to-have,
    // and the rating prompt simply won't appear.
  }
}

/** Clear the in-progress order (e.g. once it's completed or cancelled). */
export function forgetOrder(restaurantId: string): void {
  try {
    localStorage.removeItem(key(restaurantId));
    // The history stays: the order is finished, which is exactly when it
    // becomes rateable.
  } catch {
    // Ignore — nothing to clean up if storage is unavailable.
  }
}

/** The stored in-progress order id for this restaurant, if any. */
export function recallOrder(restaurantId: string): string | null {
  try {
    return localStorage.getItem(key(restaurantId));
  } catch {
    return null;
  }
}

/** Every order this device has placed at this restaurant, newest first. */
export function recallOrders(restaurantId: string): string[] {
  try {
    const raw = localStorage.getItem(listKey(restaurantId));
    if (!raw) {
      // Upgrade path: devices that ordered before the list existed still have
      // the single key, and shouldn't lose their one rateable order.
      const single = localStorage.getItem(key(restaurantId));
      return single ? [single] : [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === "string") : [];
  } catch {
    // Corrupt or unavailable storage reads as "no orders", never a throw.
    return [];
  }
}
