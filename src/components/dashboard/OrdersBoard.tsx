"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useRestaurantOrders } from "@/hooks/useRestaurantOrders";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { orderCode, type Order, type Restaurant, type ServiceRequest } from "@/lib/types";
import Breadcrumb from "@/components/layout/Breadcrumb";
import OrderCard from "./OrderCard";
import ServiceRequestsBar from "./ServiceRequestsBar";

interface OrdersBoardProps {
  restaurant: Restaurant;
  initialOrders: Order[];
  initialRequests: ServiceRequest[];
}

type Tab = "live" | "history";

const LIVE_STATUSES = new Set(["received", "preparing", "ready"]);

/** True when the order was placed today (local time). */
function isToday(order: Order): boolean {
  return new Date(order.created_at).toDateString() === new Date().toDateString();
}

/** Kitchen dashboard: live order grid with stats, plus a history tab. */
export default function OrdersBoard({ restaurant, initialOrders, initialRequests }: OrdersBoardProps) {
  const { orders, updateStatus, cancelOrder } = useRestaurantOrders(restaurant.id, initialOrders);
  const [tab, setTab] = useState<Tab>("live");
  const confirm = useConfirm();
  const toast = useToast();

  const live = orders.filter((o) => LIVE_STATUSES.has(o.status));
  const history = orders.filter((o) => !LIVE_STATUSES.has(o.status));
  const shown = tab === "live" ? live : history;

  const activeCount = live.filter((o) => o.status === "received" || o.status === "preparing").length;
  // Today's takings: paid orders placed today, minus anything refunded.
  const revenue = orders.reduce(
    (sum, o) => sum + (o.paid && o.status !== "cancelled" && isToday(o) ? o.total : 0),
    0
  );

  async function handleCancel(order: Order): Promise<void> {
    const ok = await confirm({
      title: `Cancel order ${orderCode(order.id)}?`,
      message: order.paid
        ? `The customer will be refunded ${formatMoney(order.total, restaurant.currency)}.`
        : "This order hasn't been paid — it will just be cancelled.",
      confirmLabel: order.paid ? "Cancel & refund" : "Cancel order",
      danger: true,
    });
    if (!ok) return;
    const error = await cancelOrder(order.id);
    if (error) toast(error, "error");
    else toast(order.paid ? "Order cancelled and refunded" : "Order cancelled");
  }

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Orders" }]} />
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

        <ServiceRequestsBar restaurantId={restaurant.id} initialRequests={initialRequests} />

        <div className="tt-board-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "live"}
            className={`tt-board-tab ${tab === "live" ? "tt-board-tab-active" : ""}`}
            onClick={() => setTab("live")}
          >
            Live{live.length > 0 ? ` (${live.length})` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            className={`tt-board-tab ${tab === "history" ? "tt-board-tab-active" : ""}`}
            onClick={() => setTab("history")}
          >
            History
          </button>
        </div>

        {shown.length === 0 ? (
          <div className="tt-empty">
            <div style={{ fontSize: 48 }}>📭</div>
            <strong>{tab === "live" ? "No live orders" : "No past orders yet"}</strong>
            <p className="tt-muted">
              {tab === "live"
                ? "New orders appear here in real time."
                : "Completed and cancelled orders land here."}
            </p>
          </div>
        ) : (
          <div className="tt-orders-grid">
            {shown.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                currency={restaurant.currency}
                onAdvance={updateStatus}
                onCancel={handleCancel}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
