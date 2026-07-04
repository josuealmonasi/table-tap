"use client";

import { useEffect, useState } from "react";
import type { OrderStatus } from "@/lib/types";
import type { TrackedOrder } from "@/lib/order-tracking";

const TERMINAL: OrderStatus[] = ["completed", "cancelled"];
const INTERVAL_MS = 5000;

/**
 * Keeps a single order fresh by polling /api/order-status, seeded from the
 * server-rendered order so there's no loading flash. Polling stops once the
 * order reaches a terminal status. (Orders aren't readable with the client
 * key, so we can't subscribe to realtime — polling a server route is the
 * secure equivalent.)
 */
export function useOrderPolling(initialOrder: TrackedOrder): TrackedOrder {
  const [order, setOrder] = useState<TrackedOrder>(initialOrder);

  useEffect(() => {
    if (TERMINAL.includes(order.status)) return;

    let active = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/order-status?id=${initialOrder.id}`);
        if (!res.ok) return;
        const next = (await res.json()) as TrackedOrder;
        if (active) setOrder(next);
      } catch {
        // Transient network error — keep the last known state and retry next tick.
      }
    }, INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [initialOrder.id, order.status]);

  return order;
}
