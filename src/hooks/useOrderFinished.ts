"use client";

import { useEffect, useState } from "react";

/** How often it asks. The open tracker goes faster; this is the background
 *  heartbeat, for the button sitting on the menu. */
const EVERY_MS = 15_000;

/** For the diner an order ends when it is handed over, or cancelled. */
const DONE = ["completed", "cancelled"];

/**
 * Whether the order this phone was following has finished.
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
export function useOrderFinished(orderId: string | null): boolean {
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDone(false);
    if (!orderId) return;

    let alive = true;
    const read = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/order-status?id=${orderId}`);
        if (!res.ok) return; // un 404 es un pedido borrado: lo dirá la próxima
        const order = (await res.json()) as { status?: string };
        if (alive && order.status && DONE.includes(order.status)) setDone(true);
      } catch {
        // No network: try again on the next pass.
      }
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
  }, [orderId]);

  return done;
}
