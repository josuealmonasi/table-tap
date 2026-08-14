"use client";

/**
 * The orders this phone placed, per restaurant.
 *
 * There are no diner accounts, so this is the only thing that distinguishes
 * "my food" from "the rest of the table" on a shared bill. Losing it is not
 * serious — the bill still shows everything the table owes, the diner just
 * can't single out their own share — so it lives in localStorage rather than
 * costing a column and a lookup.
 */

const KEY = (restaurantId: string) => `tt:orders:${restaurantId}`;

/** Ids of orders placed from this phone, oldest first. */
export function myOrderIds(restaurantId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY(restaurantId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Records an order this phone just placed. */
export function rememberOrder(restaurantId: string, orderId: string): void {
  if (typeof window === "undefined") return;
  try {
    const ids = myOrderIds(restaurantId);
    if (ids.includes(orderId)) return;
    // A cap, so a regular's phone doesn't grow this forever. Well past any
    // single visit, which is all it is used for.
    const next = [...ids, orderId].slice(-40);
    localStorage.setItem(KEY(restaurantId), JSON.stringify(next));
  } catch {
    // A phone with storage disabled just loses the "pay only mine" option.
  }
}
