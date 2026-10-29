"use client";

import { formatMoney } from "@/lib/format";
import { useRestaurantOrders } from "@/hooks/useRestaurantOrders";
import OrdersReadError from "./OrdersReadError";
import OfflineBanner from "@/components/dashboard/OfflineBanner";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { type Order, type Restaurant } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";
import OrderHistory from "./OrderHistory";
import OrderReturnsPanel from "./OrderReturnsPanel";
import OrderCard from "./OrderCard";
import { BOARD_COLUMNS, columnOrders } from "@/lib/order-flow";
import { useRouter } from "next/navigation";
import ServiceRequestsBar from "./ServiceRequestsBar";
import { readyToDeliver } from "@/lib/ready-tables";
import { EmptyIcon } from "@/components/ui/icons";
import { cancelWording } from "@/lib/cancel-wording";
import { inStation, viewStatus, type Station } from "@/lib/stations";
import { useBoardStation } from "@/hooks/useBoardStation";
import { useRefreshWhenPaid } from "@/hooks/useRefreshWhenPaid";
import { boardOrderCode, hasOrderMoney, isPreparationOrder, type BoardOrder, type BoardRequest } from "@/lib/kitchen-ticket";
import StationFilter from "./StationFilter";
import OrdersTakings, { ordersTakingsChanged } from "./OrdersTakings";

interface OrdersBoardProps {
  restaurant: Pick<Restaurant, "id" | "currency" | "ticket_warn_minutes" | "ticket_late_minutes">;
  initialOrders: BoardOrder[];
  snapshotReadAt?: number;
  ordersReadFailed?: boolean;
  requestsReadFailed?: boolean;
  kitchen?: boolean;
  initialRequests: BoardRequest[];
  /** Cancelling triggers refunds, so only the owner gets the button. */
  canCancel: boolean;
  /** False for waiters: complete only, no stage moves. */
  canMove: boolean;
  /** Taking cash and writing debts off is the floor's job, not the kitchen's. */
  canSettle: boolean;
  /**
   * Whether this person is the one who carries plates out.
   *
   * Narrower than `canSettle` on purpose. The ready chips are a queue of
   * journeys to make, and a queue of somebody else's journeys on a screen you
   * are working is a screen you start reading past — which is how the table
   * asking for a waiter, two chips down, gets read past too.
   */
  isWaiter: boolean;
  /** Owner or manager: may cancel a bill outright rather than ask. */
  canApprove: boolean;
  /** Kitchen doesn't get the daily takings stat. */
  showRevenue: boolean;
  /** Collected since the restaurant's midnight, net of returns: the corte's figure. */
  collectedToday: number;
  /** The menu has a section made at the bar, so the board offers stations. */
  hasStations?: boolean;
}


/**
 * Kitchen dashboard: the live order grid.
 *
 * The live queue stays first, watched every minute during service. Managers
 * also get completed history below it, to find a sale by code and return
 * money without cancelling food already served. The kitchen never reads
 * that history or its amounts. Keeping history outside the live columns
 * prevents a lookup from replacing the pass in the middle of service.
 */
export default function OrdersBoard({
  restaurant,
  initialOrders,
  snapshotReadAt = 0,
  ordersReadFailed = false,
  requestsReadFailed = false,
  initialRequests,
  canCancel,
  canMove,
  canSettle,
  isWaiter,
  canApprove,
  showRevenue,
  collectedToday,
  hasStations = false,
  kitchen = false,
}: OrdersBoardProps) {
  const router = useRouter();
  const t = useT();
  const { orders, inactiveOrderIds, hideInactive, updateStatus, cancelOrder, cancelPlanFor, online, pending } = useRestaurantOrders(
    restaurant.id,
    initialOrders,
    kitchen,
    snapshotReadAt,
  );
  const confirm = useConfirm();
  const toast = useToast();
  useRefreshWhenPaid(orders, showRevenue && !kitchen, restaurant.id);
  function refreshTakings(): void {
    if (showRevenue && !kitchen) ordersTakingsChanged(restaurant.id);
  }

  const [station, setStation] = useBoardStation(restaurant.id, hasStations);
  // This screen's station sees only orders it makes something in, each in
  // the column its own part has reached.
  const live = orders.filter(o => isPreparationOrder(o) && !inactiveOrderIds.has(o.id) && inStation(o, station));
  const byId = new Map(live.map(o => [o.id, o]));
  const viewed = live.map(o => ({ ...o, status: viewStatus(o, station) }));

  /** A station finished its part; the database decides whether the order is ready. */
  async function markStationReady(id: string, done: Station): Promise<void> {
    try {
      const res = await fetch("/api/orders/station", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, station: done }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.inactive === true) hideInactive(id);
        toast(data.error ?? t("orders.moveRefused"), "error");
      }
    } catch {
      toast(t("done.networkError"), "error");
    }
  }

  const activeCount = live.filter(
    o => o.status === "received" || o.status === "preparing",
  ).length;

  async function handleCancel(order: Order): Promise<void> {
    // Worded from what the server says the cancel will do, never from
    // `pay_method`. Cash, a charge on the restaurant's own terminal and a share
    // of a table's bill cannot be refunded by an app; guessing offered "Cancel
    // & refund" on all of them, and the cancel then refused, for ever.
    for (;;) {
      const plan = await cancelPlanFor(order.id);
      if (typeof plan === "string") {
        toast(plan, "error");
        return;
      }
      const words = cancelWording(plan, n => formatMoney(n, order.currency ?? restaurant.currency), t);
      const ok = await confirm({
        title: t("orders.cancelConfirm", { code: boardOrderCode(order) }),
        message: words.message,
        confirmLabel: t(words.confirmKey),
        danger: true,
      });
      if (!ok) return;
      const result = await cancelOrder(order.id);
      if (!result) refreshTakings();
      toast(result?.error ?? words.done, result ? "error" : undefined);
      if (!result?.stale) return;
      // Collection can win while the dialog is open. Ask again with its new
      // refund plan; never replay the confirmation that promised no refund.
    }
  }

  return (
    <div className="tt-dash">
      <div className="container">
        {/* Before anything else on the page: what the board can and cannot do
            right now, so nobody learns it from a control that fails. */}
        {!online && <OfflineBanner pending={pending} />}
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[
              { labelKey: "nav.dashboard", href: "/dashboard" },
              { labelKey: "nav.orders" },
            ]}
          />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className="tt-stat">
              <strong className="tt-accent">{ordersReadFailed ? "—" : activeCount}</strong>
              <span>{t("orders.active")}</span>
            </div>
            {showRevenue && !kitchen && (
              <div className="tt-stat">
                <strong style={{ color: "var(--tt-success)" }}>
                  <OrdersTakings restaurantId={restaurant.id} currency={restaurant.currency} initialCollected={collectedToday} />
                </strong>
                <span>{t("orders.today")}</span>
              </div>
            )}
          </div>
        </header>

        {/* A table asking for something is waiting on a person right now, so
            it sits above the money: the debts aren't going anywhere, and a
            raised hand is the thing that gets answered first. */}
        {hasStations && <StationFilter station={station} onChange={setStation} />}

        {(ordersReadFailed || requestsReadFailed) && <OrdersReadError orders={ordersReadFailed} requests={requestsReadFailed} />}

        <ServiceRequestsBar
          kitchen={kitchen}
          restaurantId={restaurant.id}
          canSettle={canSettle}
          canApprove={canApprove}
          initialRequests={initialRequests}
          readFailed={requestsReadFailed}
          currency={restaurant.currency}
          onSettled={() => { refreshTakings(); router.refresh(); }}
          // Only for whoever carries the plate. The pass put it there, so a
          // chip telling the kitchen their own food is ready is one they learn
          // to ignore — and then they read past the table asking for a waiter
          // two chips down. The same is true of anyone else not on the floor.
          ready={isWaiter ? readyToDeliver(live.filter(hasOrderMoney)) : []}
          onDelivered={
            isWaiter ? ids => ids.forEach(id => updateStatus(id, "completed")) : undefined
          }
        />


        {live.length === 0 && (ordersReadFailed || requestsReadFailed) ? null : live.length === 0 ? (
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
              const inColumn = columnOrders(viewed, col.status).map(v => byId.get(v.id)!);
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
                          warnMinutes={restaurant.ticket_warn_minutes}
                          lateMinutes={restaurant.ticket_late_minutes}
                          onAdvance={updateStatus}
                          onCancel={canCancel ? handleCancel : undefined}
                          canMove={canMove}
                          station={station}
                          onStationReady={(id, done) => void markStationReady(id, done)}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        {canApprove && !kitchen && <>
          <OrderReturnsPanel restaurantId={restaurant.id} />
          <OrderHistory restaurantId={restaurant.id} currency={restaurant.currency} canReturn />
        </>}
      </div>
    </div>
  );
}
