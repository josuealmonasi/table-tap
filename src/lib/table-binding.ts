"use client";

/**
 * Which table this phone is sitting at, if any.
 *
 * A diner who orders at one table and walks to another was, until now, simply
 * a diner at two tables: two bills, neither aware of the other, and the first
 * one easy to walk away from. Binding the phone to its sitting closes that —
 * not by trusting the phone, which is a device somebody can clear, but by
 * making the ordinary path honest and the dishonest one deliberate.
 *
 * The server is still the authority: this only remembers an id, and every
 * check asks the server whether that sitting is open and owed for. Clearing
 * storage gets somebody a second table; it does not get them out of the first
 * bill, which the restaurant still has on its floor with a table number on it.
 *
 * localStorage rather than a cookie: nothing here is sent to the server on its
 * own, it is per-device like the rest of the diner's state, and a cookie for
 * this would be sent on every menu image request for no reason.
 */

const KEY = (restaurantId: string) => `tt-sitting:${restaurantId}`;

export interface Sitting {
  sessionId: string;
  tableId: string;
}

export function rememberSitting(
  restaurantId: string,
  sessionId: string,
  tableId: string,
): void {
  try {
    localStorage.setItem(KEY(restaurantId), JSON.stringify({ sessionId, tableId }));
  } catch {
    // A phone with storage off just isn't bound; the floor still has the bill.
  }
}

export function recallSitting(restaurantId: string): Sitting | null {
  try {
    const raw = localStorage.getItem(KEY(restaurantId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Sitting).sessionId === "string" &&
      typeof (parsed as Sitting).tableId === "string"
    ) {
      return parsed as Sitting;
    }
    return null;
  } catch {
    return null;
  }
}

export function forgetSitting(restaurantId: string): void {
  try {
    localStorage.removeItem(KEY(restaurantId));
  } catch {
    // ignore
  }
}
