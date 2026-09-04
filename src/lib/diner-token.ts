/**
 * A name this phone gives itself for the evening.
 *
 * A diner has no login, so when a table divides a bill there has to be some way
 * to tell one seat from another. This is it: a random string kept next to the
 * sitting, meaning nothing to anybody else and worth nothing if copied — the
 * sitting id is the capability, and this only says which seat within it.
 *
 * Per restaurant, so a phone that ate somewhere else last week does not arrive
 * holding a seat at this table.
 */
const KEY = (restaurantId: string) => `tt-diner:${restaurantId}`;

export function dinerToken(restaurantId: string): string {
  try {
    const kept = localStorage.getItem(KEY(restaurantId));
    if (kept) return kept;
    const made =
      globalThis.crypto?.randomUUID?.() ?? `d${Date.now()}${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(KEY(restaurantId), made);
    return made;
  } catch {
    // Storage off: the phone can still read the bill, it just cannot hold a
    // seat in a split. Better than throwing on a screen someone is paying from.
    return "";
  }
}

export function forgetDiner(restaurantId: string): void {
  try {
    localStorage.removeItem(KEY(restaurantId));
  } catch {
    // Nothing kept, nothing to forget.
  }
}
