"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/format";
import { backwardOptions } from "@/lib/order-flow";
import { MoveToIcon } from "@/components/ui/icons";
import { orderCode, type Order, type OrderStatus } from "@/lib/types";
import OrderDetailDialog from "./OrderDetailDialog";
import { STATUS_META, statusMeta } from "@/lib/order-status";
import { useT } from "@/lib/i18n/context";


/** Map an order's current status to the button that advances it. */
function nextAction(
  status: OrderStatus,
): { labelKey: string; to: OrderStatus; variant: string } | null {
  if (status === "received")
    return {
      labelKey: "orders.startPreparing",
      to: "preparing",
      variant: "tt-btn-primary",
    };
  if (status === "preparing")
    return { labelKey: "orders.markReady", to: "ready", variant: "tt-btn-success" };
  if (status === "ready")
    return { labelKey: "orders.complete", to: "completed", variant: "tt-btn-ghost" };
  return null;
}

interface OrderCardProps {
  order: Order;
  currency: string;
  onAdvance: (id: string, status: OrderStatus) => void;
  /** Cancel + refund; offered on new/preparing orders only. */
  onCancel?: (order: Order) => void;
  /** False for waiters: complete only, no stage moves. */
  canMove?: boolean;
}

/** One order on the kitchen board: table, items, total, and its advance button. */
export default function OrderCard({
  order,
  currency,
  onAdvance,
  onCancel,
  canMove = true,
}: OrderCardProps) {
  const t = useT();
  const meta = statusMeta(order.status);
  const action = nextAction(order.status);
  // A waiter closes out a handed-over order and nothing else; the kitchen
  // owns every other stage change.
  const moveBack = canMove ? backwardOptions(order.status) : [];
  const canAdvance = canMove || action?.to === "completed";
  const [moveOpen, setMoveOpen] = useState(false);
  const [detail, setDetail] = useState(false);
  const moveRef = useRef<HTMLDivElement>(null);

  // Close on a click anywhere else, the way every other menu in the app does.
  useEffect(() => {
    if (!moveOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moveRef.current?.contains(e.target as Node)) setMoveOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moveOpen]);
  const cancellable = order.status === "received" || order.status === "preparing";
  const placedAt = new Date(order.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className="tt-order-card tt-order-card-open"
      style={{ borderLeft: `4px solid ${meta.color}` }}
      role="button"
      tabIndex={0}
      aria-label={t("orders.openDetail", { code: orderCode(order.id) })}
      // The card opens the detail; the buttons on it keep doing their own job,
      // which is why every control below stops the click from reaching here.
      onClick={() => setDetail(true)}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setDetail(true);
        }
      }}
    >
      {/* The dialog renders inside this card, so its clicks would bubble
          back into the card's own handler — closing it reopened it in the
          same gesture, which is why it looked like it couldn't be closed. */}
      <div onClick={e => e.stopPropagation()} role="presentation">
        <OrderDetailDialog
          order={order}
          currency={currency}
          open={detail}
          onClose={() => setDetail(false)}
        />
      </div>
      {/* Two rows, each with an anchor on both sides: what the order is
          (table, code) above how it stands (placed at, status). The code used
          to sit under the table name where it read as a subtitle rather than
          the other half of the identity. */}
      <div className="tt-order-head">
        <div className="tt-row">
          <strong style={{ fontSize: 16 }}>
            {/* A general-QR order has no table: it used to read a bare "Mesa"
                with a gap where the number goes. The thing worth knowing about
                it is precisely that there is no table to carry it to. */}
            {order.table_label
              ? t("dash.tableN", { label: order.table_label })
              : (order.customer_name ?? t("dash.billsToGo"))}
          </strong>
          <span className="tt-order-code">{orderCode(order.id)}</span>
        </div>
        <div className="tt-row">
          <span className="tt-muted" style={{ fontSize: 12 }}>
            {placedAt}
          </span>
          <span className="tt-order-flags">
            {/* Whoever hands the order over has to see that it is unpaid before
                letting go of it. A general-QR order that chose to pay at the
                till arrives here like any other, and without this the food
                leaves with nobody having collected. */}
            {!order.paid && (
              <span className="tt-status-badge tt-unpaid-badge">
                {t("orders.notPaid")}
              </span>
            )}
            <span
              className="tt-status-badge"
              style={{ color: meta.color, background: `${meta.color}1a` }}
            >
              {t(meta.labelKey)}
            </span>
          </span>
        </div>
      </div>

      <div className="tt-order-items">
        {order.items.map((item, i) => (
          <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
            <span className="tt-muted">{item.qty}× </span>
            {item.emoji} {item.name}
            {Object.keys(item.mods ?? {}).length > 0 && (
              <span className="tt-muted" style={{ fontSize: 11 }}>
                {" "}
                (
                {Object.values(item.mods ?? {})
                  .map(v => (Array.isArray(v) ? v.join(", ") : v))
                  .join(" · ")}
                )
              </span>
            )}
            {item.notes && (
              <div className="tt-accent tt-subline" style={{ fontSize: 11, fontStyle: "italic" }}>
                ↳ {item.notes}
              </div>
            )}
          </div>
        ))}
        {order.note && (
          <div
            className="tt-accent"
            style={{ fontSize: 12, fontStyle: "italic", marginTop: 6 }}
          >
            📝 {order.note}
          </div>
        )}
      </div>

      {/* The buttons drop below the total when the card is too narrow to hold
          both — see .tt-order-actions. Squeezed in place they wrapped their own
          labels and the last one hung off the edge of the card. */}
      <div className="tt-order-foot">
        <strong className="tt-accent">{formatMoney(order.total, currency)}</strong>
        <div className="tt-order-actions">
          {/* Sending a ticket back a stage — a plate returned, a mis-tap. Only
              earlier stages appear: forward is what the main button does, and
              offering both here would make the obvious action ambiguous. */}
          {moveBack.length > 0 && (
            <div className="tt-move" ref={moveRef}>
              <button
                className="tt-iconbtn"
                aria-haspopup="menu"
                aria-expanded={moveOpen}
                title={t("orders.moveBack")}
                onClick={e => {
                  e.stopPropagation();
                  setMoveOpen(o => !o);
                }}
              >
                <MoveToIcon size={16} />
              </button>
              {moveOpen && (
                <div className="tt-move-menu" role="menu">
                  {moveBack.map(status => (
                    <button
                      key={status}
                      role="menuitem"
                      className="tt-move-item"
                      onClick={e => {
                        e.stopPropagation();
                        setMoveOpen(false);
                        onAdvance(order.id, status);
                      }}
                    >
                      {t("orders.moveTo", { status: t(STATUS_META[status].labelKey) })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {cancellable && onCancel && (
            <button
              className="tt-btn tt-btn-ghost tt-btn-sm"
              onClick={e => {
                e.stopPropagation();
                onCancel(order);
              }}
            >
              {t("common.cancel")}
            </button>
          )}
          {action && canAdvance ? (
            <button
              className={`tt-btn ${action.variant} tt-btn-sm`}
              onClick={e => {
                e.stopPropagation();
                onAdvance(order.id, action.to);
              }}
            >
              {t(action.labelKey)}
            </button>
          ) : order.status === "cancelled" ? (
            <span className="tt-muted" style={{ fontSize: 13, fontWeight: 700 }}>
              {t("orders.cancelledLabel")}
              {order.stripe_refund_id ? t("orders.refunded") : ""}
            </span>
          ) : (
            <span style={{ color: "var(--tt-success)", fontSize: 13, fontWeight: 700 }}>
              {t("orders.done")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
