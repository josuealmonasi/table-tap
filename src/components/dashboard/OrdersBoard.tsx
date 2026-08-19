"use client";

import { formatMoney } from "@/lib/format";
import { useRestaurantOrders } from "@/hooks/useRestaurantOrders";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { orderCode, type Order, type Restaurant, type ServiceRequest } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";
import OrderCard from "./OrderCard";
import { BOARD_COLUMNS, columnOrders } from "@/lib/order-flow";
import { useRouter } from "next/navigation";
import ServiceRequestsBar from "./ServiceRequestsBar";
import { EmptyIcon } from "@/components/ui/icons";

interface OrdersBoardProps {
  restaurant: Restaurant;
  initialOrders: Order[];
  initialRequests: ServiceRequest[];
  /** Cancelling triggers refunds, so only the owner gets the button. */
  canCancel: boolean;
  /** False for waiters: complete only, no stage moves. */
  canMove: boolean;
  /** Taking cash and writing debts off is the floor's job, not the kitchen's. */
  canSettle: boolean;
  /** Owner or manager: may cancel a bill outright rather than ask. */
  canApprove: boolean;
  /** Kitchen doesn't get the daily takings stat. */
  showRevenue: boolean;
  /** Today's takings from orders NOT in the loaded set (server-computed). */
  revenueBase: number;
  /** Start of today (ms) — the shared day boundary for the revenue stat. */
  todayStartMs: number;
}


const LIVE_STATUSES = new Set(["received", "preparing", "ready"]);

/**
 * Kitchen dashboard: the live order grid.
 *
 * El historial se mudó a Analíticas. Vivían juntos detrás de una pestaña, y
 * son trabajos distintos: lo de en vivo se mira cada minuto durante el
 * servicio, el historial se busca por código de pedido cuando alguien
 * pregunta por uno. Compartir pantalla significaba que la cocina podía caer
 * en los datos del mes pasado en plena comida.
 */
export default function OrdersBoard({
  restaurant,
  initialOrders,
  initialRequests,
  canCancel,
  canMove,
  canSettle,
  canApprove,
  showRevenue,
  revenueBase,
  todayStartMs,
}: OrdersBoardProps) {
  const router = useRouter();
  const t = useT();
  const { orders, updateStatus, cancelOrder } = useRestaurantOrders(
    restaurant.id,
    initialOrders,
  );
  const confirm = useConfirm();
  const toast = useToast();

  const live = orders.filter(o => LIVE_STATUSES.has(o.status));

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

        {/* A table asking for something is waiting on a person right now, so
            it sits above the money: the debts aren't going anywhere, and a
            raised hand is the thing that gets answered first. */}
        <ServiceRequestsBar
          restaurantId={restaurant.id}
          canSettle={canSettle}
          canApprove={canApprove}
          initialRequests={initialRequests}
          currency={restaurant.currency}
          onSettled={() => router.refresh()}
        />


        {live.length === 0 ? (
          <div className="tt-empty">
            <EmptyIcon size={44} className="tt-empty-icon" />
            <strong>{t("orders.noLive")}</strong>
            <p className="tt-muted">{t("orders.liveHint")}</p>
          </div>
        ) : (
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
                          canMove={canMove}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
