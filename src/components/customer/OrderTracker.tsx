"use client";

import { orderCode, type Order, type OrderStatus } from "@/lib/types";
import { useOrderRealtime } from "@/hooks/useOrderRealtime";
import OrderStatusTimeline from "./OrderStatusTimeline";
import TrackedItemsCard from "./TrackedItemsCard";

/** Collapse the full order status into the three stages the diner sees. */
function toDisplayStatus(status: OrderStatus): OrderStatus {
  if (status === "completed") return "ready";
  if (status === "pending_payment") return "received";
  return status;
}

const HERO: Record<string, { headline: string; emoji: string }> = {
  ready: { headline: "Your order is ready!", emoji: "🍱" },
  preparing: { headline: "Chef is preparing it", emoji: "👨‍🍳" },
  received: { headline: "Order received!", emoji: "📋" },
};

/** Live order tracking screen the diner lands on after paying. */
export default function OrderTracker({ initialOrder }: { initialOrder: Order }) {
  const order = useOrderRealtime(initialOrder);
  const status = toDisplayStatus(order.status);
  const hero = HERO[status] ?? HERO.received;

  return (
    <div className="tt-root">
      <div className="tt-track-hero">
        <div style={{ fontSize: 48 }}>{hero.emoji}</div>
        <h2 className="tt-serif" style={{ margin: 0, fontSize: 22 }}>{hero.headline}</h2>
        <div className="tt-sage" style={{ fontSize: 13, marginTop: 4 }}>{orderCode(order.id)}</div>
      </div>

      <div style={{ padding: 20 }}>
        <OrderStatusTimeline status={status} tableLabel={order.table_label} />
        <TrackedItemsCard items={order.items} total={order.total} currency={order.currency} />
      </div>
    </div>
  );
}
