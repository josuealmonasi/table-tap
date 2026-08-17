"use client";

/**
 * Whether this phone has already taken a suggestion on the bill it is building.
 *
 * A waiter asks "anything else?" once. Asking again after they said yes is how
 * a helpful question turns into pestering, so the answer is remembered until
 * the bill is done with — the same moment the cart is cleared.
 */
const KEY = (restaurantId: string) => `tt-upsell:${restaurantId}`;

export function upsellTaken(restaurantId: string): boolean {
  try {
    return localStorage.getItem(KEY(restaurantId)) === "1";
  } catch {
    // Private mode: the diner sees the question again, which is a small cost.
    return false;
  }
}

export function markUpsellTaken(restaurantId: string): void {
  try {
    localStorage.setItem(KEY(restaurantId), "1");
  } catch {
    // Nothing to do — the suggestion simply shows again.
  }
}

/** Called when a bill closes, so the next table gets asked as they should. */
export function clearUpsell(restaurantId: string): void {
  try {
    localStorage.removeItem(KEY(restaurantId));
  } catch {
    // Ignored: a stale flag only means one unasked question.
  }
}
