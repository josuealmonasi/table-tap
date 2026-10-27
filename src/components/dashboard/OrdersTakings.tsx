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

interface Takings {
  restaurantId: string;
  currency: string;
  collectedToday: number;
}

async function readTakings([url, restaurantId, currency]: readonly [string, string, string]): Promise<Takings> {
  const data = await readDashboardJson<Takings>([url, restaurantId]);
  // Membership can change while this board is still mounted. Keep its last
  // good figure rather than label another restaurant's money in this currency.
  if (data.restaurantId !== restaurantId || data.currency !== currency || !Number.isFinite(data.collectedToday))
    throw new Error("Invalid takings response");
  return data;
}

/** Mounted only for managers: money never comes from the browser's order list. */
export default function OrdersTakings({ restaurantId, currency, initialCollected }: OrdersTakingsProps) {
  // Mounted only for a manager, and a reply for any other restaurant or
  // currency is refused below, so the shared cache cannot show another's money.
  const { data, mutate } = useSWR(["/api/orders/takings", restaurantId, currency] as const, readTakings, {
    fallbackData: { restaurantId, currency, collectedToday: initialCollected },
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
