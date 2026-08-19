"use client";

/**
 * What this phone was offered as "anything else?" on the bill it is building.
 *
 * A waiter asks once and the answer stands: the suggestion stays on the order
 * screen until the diner takes one or the bill is done with. Storing only
 * *that* we had asked was the bug — the strip was cleared on leaving the cart
 * and the flag then refused to let it come back, so tapping "agregar más
 * platillos" and returning made the question vanish for the rest of the meal.
 * Remembering *what* was offered keeps the same three dishes on show without
 * reshuffling under the diner's thumb.
 */
const KEY = (restaurantId: string) => `tt-upsell:${restaurantId}`;

/** The dish ids offered on this bill, or null if nothing has been offered. */
export function offeredUpsell(restaurantId: string): string[] | null {
  try {
    const raw = localStorage.getItem(KEY(restaurantId));
    if (!raw) return null;
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) && ids.every(i => typeof i === "string") ? ids : null;
  } catch {
    // Private mode, or something else wrote the key: offer afresh.
    return null;
  }
}

export function rememberUpsell(restaurantId: string, ids: string[]): void {
  try {
    localStorage.setItem(KEY(restaurantId), JSON.stringify(ids));
  } catch {
    // Nothing to do — the suggestion is simply worked out again next time.
  }
}

/** Called when a bill closes, so the next table gets asked as they should. */
export function clearUpsell(restaurantId: string): void {
  try {
    localStorage.removeItem(KEY(restaurantId));
  } catch {
    // Ignored: a stale offer only means one repeated question.
  }
}
