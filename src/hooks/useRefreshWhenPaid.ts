"use client";

import { useEffect, useRef } from "react";
import { ordersTakingsChanged } from "@/components/dashboard/OrdersTakings";
import { hasOrderMoney, type BoardOrder } from "@/lib/kitchen-ticket";

/** Long enough that a table paying four shares asks the server once. */
export const PAID_REFRESH_MS = 1500;

/**
 * Today's takings come from the payments ledger, which a browser cannot read,
 * so the board cannot add a payment up itself. Realtime money changes ask for
 * the figure again; polling also catches partial collections, split shares and
 * returns that leave orders.paid untouched. Its own collections invalidate it.
 */
export function useRefreshWhenPaid(orders: BoardOrder[], enabled: boolean, restaurantId = ""): void {
  // Only what moves money: a stage change in the kitchen is not a reason to
  // ask the server, and on a busy night it would be every few seconds.
  const money = orders.filter(hasOrderMoney)
    .map(o => `${o.id}:${o.paid}:${o.status === "cancelled"}:${o.total}`).sort().join(",");
  const seen = useRef(money);

  useEffect(() => {
    if (!enabled || money === seen.current) return;
    const timer = setTimeout(() => {
      seen.current = money;
      ordersTakingsChanged(restaurantId);
    }, PAID_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [enabled, money, restaurantId]);
}
