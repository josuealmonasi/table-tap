"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { formatMoney } from "@/lib/format";
import { readDashboardJson } from "@/lib/dashboard-read";

const TAKINGS_CHANGED = "tt-orders-takings-changed";

/** Like badges, invalidate the mounted board's own SWR provider after a write. */
export function ordersTakingsChanged(restaurantId: string): void {
  window.dispatchEvent(new CustomEvent(TAKINGS_CHANGED, { detail: restaurantId }));
}

interface OrdersTakingsProps {
  restaurantId: string;
  currency: string;
  initialCollected: number;
}

async function readTakings(key: readonly [string, string]): Promise<{ collectedToday: number }> {
  const data = await readDashboardJson<{ collectedToday: number }>(key);
  if (typeof data.collectedToday !== "number") throw new Error("Invalid takings response");
  return data;
}

/** Mounted only for managers: money never comes from the browser's order list. */
export default function OrdersTakings({ restaurantId, currency, initialCollected }: OrdersTakingsProps) {
  const { data, mutate } = useSWR(["/api/orders/takings", restaurantId] as const, readTakings, {
    fallbackData: { collectedToday: initialCollected },
    revalidateOnMount: false,
    refreshInterval: 30_000,
  });
  useEffect(() => {
    const refresh = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === restaurantId)
        void mutate().catch(() => {}); // A failed read retains the last successful figure.
    };
    window.addEventListener(TAKINGS_CHANGED, refresh);
    return () => window.removeEventListener(TAKINGS_CHANGED, refresh);
  }, [restaurantId, mutate]);
  return <>{formatMoney(data.collectedToday, currency)}</>;
}
