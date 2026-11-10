"use client";

import type { CartItem } from "@/hooks/useCart";

/**
 * The cart lines sent to Stripe, kept until that order comes back paid.
 *
 * A card checkout leaves the page, so the cart is still in storage when the
 * diner returns. Without this, the meal they just paid for sat in the cart
 * and one tap ordered it a second time (end-to-end review, A4). A checkout
 * abandoned at Stripe never returns paid, so its cart stays as it was.
 */

const KEY = (restaurantId: string) => `tt:card-lines:${restaurantId}`;

interface Pending { orderId: string; lines: CartItem[] }

export function rememberCardLines(restaurantId: string, orderId: string, lines: CartItem[]): void {
  try {
    localStorage.setItem(KEY(restaurantId), JSON.stringify({ orderId, lines } satisfies Pending));
  } catch {
    // Private mode: the cart keeps the lines and the diner can clear it by hand.
  }
}

/** The lines paid for by this order, once; null when they belong to another. */
export function takePaidCardLines(restaurantId: string, orderId: string): CartItem[] | null {
  try {
    const raw = localStorage.getItem(KEY(restaurantId));
    const pending = raw ? (JSON.parse(raw) as Partial<Pending>) : null;
    if (!pending || pending.orderId !== orderId || !Array.isArray(pending.lines)) return null;
    localStorage.removeItem(KEY(restaurantId));
    return pending.lines;
  } catch {
    return null;
  }
}
