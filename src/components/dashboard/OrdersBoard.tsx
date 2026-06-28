"use client";

import { formatMoney } from "@/lib/format";
import { useRestaurantOrders } from "@/hooks/useRestaurantOrders";
import type { Order, Restaurant } from "@/lib/types";
import OrderCard from "./OrderCard";

/** Kitchen dashboard: live order grid with a stats header. */
export default function OrdersBoard({
  restaurant,
  initialOrders,
}: {
  restaurant: Restaurant;
  initialOrders: Order[];
}) {
  const { orders, updateStatus } = useRestaurantOrders(restaurant.id, initialOrders);

  const activeCount = orders.filter(
    (o) => o.status === "received" || o.status === "preparing"
  ).length;
  const revenue = orders.reduce((sum, o) => sum + (o.paid ? o.total : 0), 0);

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <h1 className="tt-serif" style={{ margin: 0 }}>Live Orders</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className="tt-stat">
              <strong className="tt-accent">{activeCount}</strong>
              <span>Active</span>
            </div>
            <div className="tt-stat">
              <strong style={{ color: "var(--tt-success)" }}>{formatMoney(revenue, restaurant.currency)}</strong>
              <span>Today</span>
            </div>
          </div>
        </header>

        {orders.length === 0 ? (
          <div className="tt-empty">
            <div style={{ fontSize: 48 }}>📭</div>
            <strong>No orders yet</strong>
            <p className="tt-muted">New orders appear here in real time.</p>
          </div>
        ) : (
          <div className="tt-orders-grid">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                currency={restaurant.currency}
                onAdvance={updateStatus}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
