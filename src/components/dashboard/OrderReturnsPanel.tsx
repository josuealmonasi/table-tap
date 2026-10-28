"use client";

import useSWR from "swr";
import { useT } from "@/lib/i18n/context";
import type { RefundOperation } from "@/lib/refunds/operations";
import OrderRefunds from "./OrderRefunds";

async function read(): Promise<RefundOperation[]> {
  try {
  const response = await fetch("/api/order-refunds");
  if (!response.ok) throw new Error("Could not read the pending returns");
  return (await response.json()).refunds;
  } catch { throw new Error("Could not read the pending returns"); }
}

/** A lost preparation reply still leaves its saved plan visible on Pedidos. */
export default function OrderReturnsPanel({ restaurantId }: { restaurantId: string }) {
  const t = useT();
  const { data, error, mutate } = useSWR(["/api/order-refunds", restaurantId], read, { refreshInterval: 15000 });
  if (error) return <div role="alert" className="tt-section">
    <p>{t("returns.readError")}</p>
    <button type="button" className="tt-btn" onClick={() => void mutate()}>{t("settle.retry")}</button>
  </div>;
  return <OrderRefunds refunds={data ?? []} />;
}
