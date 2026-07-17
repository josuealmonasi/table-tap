// Remembers the customer's most recent order per restaurant, in localStorage,
// so they can leave the tracker to browse the menu and still get back to their
// order status. The order id is unguessable and already lives in the diner's
// own URL history, so keeping it on their device carries no extra risk.

const key = (restaurantId: string) => `tt-order:${restaurantId}`;

/** Store this order as the restaurant's in-progress one for this device. */
export function rememberOrder(restaurantId: string, orderId: string): void {
  try {
    localStorage.setItem(key(restaurantId), orderId);
  } catch {
    // Private mode / storage disabled — the tracker link is a nice-to-have.
  }
}

/** Clear the stored order (e.g. once it's completed or cancelled). */
export function forgetOrder(restaurantId: string): void {
  try {
    localStorage.removeItem(key(restaurantId));
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
