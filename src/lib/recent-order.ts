// Remembers the customer's orders per restaurant, in localStorage, so they can
// leave the tracker to browse the menu and still get back to their order
// status — and so we know which dishes this device actually paid for.
//
// Order ids are unguessable and already live in the diner's own URL history,
// so keeping them on their device carries no extra risk. They are never proof
// on their own: the server re-reads every order before it acts on one.

/**
 * The in-progress orders are remembered per table, not per restaurant.
 *
 * Keyed by restaurant alone, a phone that ordered at Mesa 2 and later scanned
 * Mesa 10 was offered its Mesa 2 order — and the tracker cheerfully said the
 * food was going to Mesa 2 while the menu behind it said MESA 10. One diner
 * moving tables, or a shared house phone, was enough to produce it.
 *
 * A counter order has no table, so it keeps the plain key it always had.
 */
const key = (restaurantId: string, tableId?: string | null) =>
  tableId ? `tt-order:${restaurantId}:${tableId}` : `tt-order:${restaurantId}`;
const listKey = (restaurantId: string) => `tt-orders:${restaurantId}`;

/**
 * Everything this device has ordered here that is not finished yet.
 *
 * This used to be one slot, and a second order overwrote the first: a diner
 * who remembered a drink after ordering their food lost the way back to the
 * food. At a counter that is the whole tracker gone; at a table the bill still
 * showed the money, but watching the first order cook was no longer possible.
 *
 * A list, because more orders is the normal case and not an edge one — a
 * counter has no table to hang a running tab on, so "one more thing" is
 * always a NEW order, and each of them deserves watching until it is out.
 */
const activeKey = (restaurantId: string, tableId?: string | null) =>
  tableId ? `tt-active:${restaurantId}:${tableId}` : `tt-active:${restaurantId}`;

function readIds(storageKey: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** How many orders back we remember. A table session, not a lifetime. */
const MAX_REMEMBERED = 10;

/** Store this order as the restaurant's in-progress one for this device. */
export function rememberRecentOrder(
  restaurantId: string,
  orderId: string,
  tableId?: string | null,
): void {
  try {
    // Newest first, so the tracker opens on what they just ordered.
    const active = [orderId, ...recallActiveOrders(restaurantId, tableId).filter(id => id !== orderId)];
    localStorage.setItem(activeKey(restaurantId, tableId), JSON.stringify(active.slice(0, MAX_REMEMBERED)));
    // The old single slot is kept in step for one release: a device that
    // upgrades mid-meal still has its order where the previous code looked.
    localStorage.setItem(key(restaurantId, tableId), orderId);
    // Also append to the history. The list above answers "what can this device
    // still watch"; this one answers "what has this device bought", which is
    // what the rating prompt is entitled to ask about.
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

/**
 * Drop one finished order, leaving the rest still watchable.
 *
 * Without an id it clears the scope entirely, which is what a finished single
 * order used to mean and what a closed table still does.
 *
 * The history stays either way: an order is finished, which is exactly when it
 * becomes rateable.
 */
export function forgetOrder(
  restaurantId: string,
  tableId?: string | null,
  orderId?: string,
): void {
  try {
    if (!orderId) {
      localStorage.removeItem(activeKey(restaurantId, tableId));
      localStorage.removeItem(key(restaurantId, tableId));
      return;
    }
    const left = recallActiveOrders(restaurantId, tableId).filter(id => id !== orderId);
    localStorage.setItem(activeKey(restaurantId, tableId), JSON.stringify(left));
    // Keep the legacy slot pointing at something real, or clear it.
    if (left[0]) localStorage.setItem(key(restaurantId, tableId), left[0]);
    else localStorage.removeItem(key(restaurantId, tableId));
  } catch {
    // Ignore — nothing to clean up if storage is unavailable.
  }
}

/**
 * The orders this device can still watch here, newest first.
 *
 * Falls back to the old single slot so a device that ordered before this
 * existed does not lose its in-flight order the moment it loads new code.
 */
export function recallActiveOrders(
  restaurantId: string,
  tableId?: string | null,
): string[] {
  try {
    const list = readIds(activeKey(restaurantId, tableId));
    if (list.length > 0) return list;
    const single = localStorage.getItem(key(restaurantId, tableId));
    return single ? [single] : [];
  } catch {
    return [];
  }
}

/** The stored in-progress order id for this restaurant, if any. */
export function recallOrder(
  restaurantId: string,
  tableId?: string | null,
): string | null {
  try {
    return localStorage.getItem(key(restaurantId, tableId));
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
