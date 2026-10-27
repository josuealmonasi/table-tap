"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { hasOrderMoney, type BoardOrder } from "@/lib/kitchen-ticket";

/** Long enough that a table paying four shares asks the server once. */
export const PAID_REFRESH_MS = 1500;

/**
 * Today's takings come from the payments ledger, which a browser cannot read,
 * so the board cannot add a payment up itself. When realtime shows an order
 * becoming paid (a diner's card, another till, an account settled), it asks
 * the server for the day's figure again. Its own collections already refresh.
 */
export function useRefreshWhenPaid(orders: BoardOrder[], enabled: boolean): void {
  const router = useRouter();
  const paid = orders.filter(o => hasOrderMoney(o) && o.paid).map(o => o.id).sort().join(",");
  const seen = useRef(paid);

  useEffect(() => {
    if (!enabled || paid === seen.current) return;
    seen.current = paid;
    const timer = setTimeout(() => router.refresh(), PAID_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [enabled, paid, router]);
}
