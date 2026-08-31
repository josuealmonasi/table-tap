"use client";

import { useEffect, useState } from "react";

/** How often it asks. The open tracker goes faster; this is the background
 *  heartbeat, for the button sitting on the menu. */
const EVERY_MS = 15_000;

/** For the diner an order ends when it is handed over, or cancelled. */
const DONE = ["completed", "cancelled"];

/**
 * Which of the orders this phone is following have finished.
 *
 * The "track my order" button was read from localStorage once, on mount, and
 * nothing looked again: the kitchen marked the order delivered and the button
 * stayed there, opening the tracker for something the diner had already
 * eaten. It only went away on reload, and reloading is not something you ask
 * of someone sitting at a table.
 *
 * It asks the public tracking endpoint, the same one the sheet uses: the diner
 * cannot read `orders` directly — their RLS forbids it and it should stay that
 * way — so there is no realtime to be had on this side.
 */
export function useFinishedOrders(orderIds: string[]): string[] {
  const [done, setDone] = useState<string[]>([]);
  // An array is a new value every render; its contents are what matter.
  const key = orderIds.join(",");

  useEffect(() => {
    setDone([]);
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) return;

    let alive = true;
    const read = async (): Promise<void> => {
      // All of them each pass. A diner has one or two orders open, not
      // twenty — the cap on what is remembered keeps this small.
      const finished = await Promise.all(
        ids.map(async id => {
          try {
            const res = await fetch(`/api/order-status?id=${id}`);
            // A 404 is an order that was deleted; the next pass will say so.
            if (!res.ok) return null;
            const order = (await res.json()) as { status?: string };
            return order.status && DONE.includes(order.status) ? id : null;
          } catch {
            // No network: try again on the next pass.
            return null;
          }
        }),
      );
      const out = finished.filter((id): id is string => id !== null);
      if (alive && out.length > 0) setDone(prev => [...new Set([...prev, ...out])]);
    };

    // Only with the tab in view, like the menu refresh: a phone in a pocket has no
    // business asking, and the moment the diner looks again is exactly when being
    // up to date matters.
    const tick = () => {
      if (document.visibilityState === "visible") void read();
    };

    tick();
    const timer = setInterval(tick, EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [key]);

  return done;
}
