"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useRestaurantOrders } from "@/hooks/useRestaurantOrders";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { orderCode, type Order, type Restaurant, type ServiceRequest } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";
import OrderCard from "./OrderCard";
import { BOARD_COLUMNS, columnOrders } from "@/lib/order-flow";
import ServiceRequestsBar from "./ServiceRequestsBar";
import { EmptyIcon } from "@/components/ui/icons";

interface OrdersBoardProps {
  restaurant: Restaurant;
  initialOrders: Order[];
  initialRequests: ServiceRequest[];
  /** Cancelling triggers refunds, so only the owner gets the button. */
  canCancel: boolean;
  /** Kitchen doesn't get the daily takings stat. */
  showRevenue: boolean;
  /** Today's takings from orders NOT in the loaded set (server-computed). */
  revenueBase: number;
  /** Start of today (ms) — the shared day boundary for the revenue stat. */
  todayStartMs: number;
}

type Tab = "live" | "history";

const LIVE_STATUSES = new Set(["received", "preparing", "ready"]);

/** Kitchen dashboard: live order grid with stats, plus a history tab. */
export default function OrdersBoard({
  restaurant,
  initialOrders,
  initialRequests,
  canCancel,
  showRevenue,
  revenueBase,
  todayStartMs,
}: OrdersBoardProps) {
  const t = useT();
  const { orders, updateStatus, cancelOrder } = useRestaurantOrders(
    restaurant.id,
    initialOrders,
  );
  const [tab, setTab] = useState<Tab>("live");
  const confirm = useConfirm();
  const toast = useToast();

  const live = orders.filter(o => LIVE_STATUSES.has(o.status));
  const history = orders.filter(o => !LIVE_STATUSES.has(o.status));
  const shown = tab === "live" ? live : history;

  const activeCount = live.filter(
    o => o.status === "received" || o.status === "preparing",
  ).length;
  // Today's takings = the server base (orders beyond the loaded set) plus the
  // live slice we can see, so it stays accurate AND updates in realtime.
  const liveToday = orders.reduce(
    (sum, o) =>
      sum +
      (o.paid &&
      o.status !== "cancelled" &&
      new Date(o.created_at).getTime() >= todayStartMs
        ? o.total
        : 0),
    0,
  );
  const revenue = +(revenueBase + liveToday).toFixed(2);

  async function handleCancel(order: Order): Promise<void> {
    const ok = await confirm({
      title: t("orders.cancelConfirm", { code: orderCode(order.id) }),
      message: order.paid
        ? t("orders.refundMsg", {
            amount: formatMoney(order.total, restaurant.currency),
          })
        : t("orders.unpaidCancelMsg"),
      confirmLabel: t(order.paid ? "orders.cancelRefund" : "orders.cancelOrder"),
      danger: true,
    });
    if (!ok) return;
    const error = await cancelOrder(order.id);
    if (error) toast(error, "error");
    else toast(t(order.paid ? "orders.cancelledRefunded" : "orders.cancelledToast"));
  }

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[
              { labelKey: "nav.dashboard", href: "/dashboard" },
              { labelKey: "nav.orders" },
            ]}
          />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className="tt-stat">
              <strong className="tt-accent">{activeCount}</strong>
              <span>{t("orders.active")}</span>
            </div>
            {showRevenue && (
              <div className="tt-stat">
                <strong style={{ color: "var(--tt-success)" }}>
                  {formatMoney(revenue, restaurant.currency)}
                </strong>
                <span>{t("orders.today")}</span>
              </div>
            )}
          </div>
        </header>

        <ServiceRequestsBar
          restaurantId={restaurant.id}
          initialRequests={initialRequests}
        />

        <div className="tt-board-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "live"}
            className={`tt-board-tab ${tab === "live" ? "tt-board-tab-active" : ""}`}
            onClick={() => setTab("live")}
          >
            {t("orders.live")}
            {live.length > 0 ? ` (${live.length})` : ""}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            className={`tt-board-tab ${tab === "history" ? "tt-board-tab-active" : ""}`}
            onClick={() => setTab("history")}
          >
            {t("orders.history")}
          </button>
        </div>

        {shown.length === 0 ? (
          <div className="tt-empty">
            <EmptyIcon size={44} className="tt-empty-icon" />
            <strong>{tab === "live" ? t("orders.noLive") : t("orders.noPast")}</strong>
            <p className="tt-muted">
              {tab === "live" ? t("orders.liveHint") : t("orders.historyHint")}
            </p>
          </div>
        ) : tab === "live" ? (
          /* Live orders are a queue, not a pile: one column per stage, each
             ticket sitting under the ones that arrived before it. History stays
             a plain grid — it's browsed, not worked. */
          <div className="tt-board">
            {BOARD_COLUMNS.map(col => {
              const inColumn = columnOrders(live, col.status);
              return (
                <section key={col.status} className="tt-board-col">
                  <header className="tt-board-head">
                    <span className="tt-board-dot" style={{ background: col.color }} />
                    <h3>{t(col.labelKey)}</h3>
                    <span className="tt-board-count">{inColumn.length}</span>
                  </header>
                  <div className="tt-board-stack">
                    {inColumn.length === 0 ? (
                      <p className="tt-board-empty">{t("orders.colEmpty")}</p>
                    ) : (
                      inColumn.map(order => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          currency={restaurant.currency}
                          onAdvance={updateStatus}
                          onCancel={canCancel ? handleCancel : undefined}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="tt-orders-grid">
            {shown.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                currency={restaurant.currency}
                onAdvance={updateStatus}
                onCancel={canCancel ? handleCancel : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
