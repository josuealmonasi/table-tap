"use client";

import { formatMoney } from "@/lib/format";
import { orderCode, type Order, type OrderStatus } from "@/lib/types";
import { useT } from "@/lib/i18n/context";

const STATUS_META: Record<string, { labelKey: string; color: string }> = {
  received: { labelKey: "orders.statusNew", color: "var(--tt-gold)" },
  preparing: { labelKey: "orders.statusPreparing", color: "var(--tt-accent)" },
  ready: { labelKey: "orders.statusReady", color: "var(--tt-success)" },
  completed: { labelKey: "orders.statusCompleted", color: "var(--tt-muted)" },
  cancelled: { labelKey: "orders.statusCancelled", color: "var(--tt-muted)" },
};

/** Map an order's current status to the button that advances it. */
function nextAction(
  status: OrderStatus,
): { labelKey: string; to: OrderStatus; variant: string } | null {
  if (status === "received")
    return { labelKey: "orders.startPreparing", to: "preparing", variant: "tt-btn-primary" };
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
}

/** One order on the kitchen board: table, items, total, and its advance button. */
export default function OrderCard({
  order,
  currency,
  onAdvance,
  onCancel,
}: OrderCardProps) {
  const t = useT();
  const meta = STATUS_META[order.status] ?? STATUS_META.completed;
  const action = nextAction(order.status);
  const cancellable = order.status === "received" || order.status === "preparing";
  const placedAt = new Date(order.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="tt-order-card" style={{ borderLeft: `4px solid ${meta.color}` }}>
      <div className="tt-row">
        <div>
          <strong style={{ fontSize: 16 }}>
            {t("dash.tableN", { label: order.table_label ?? "" })}
          </strong>
          <div className="tt-muted" style={{ fontSize: 12 }}>
            {orderCode(order.id)} · {placedAt}
          </div>
        </div>
        <span
          className="tt-status-badge"
          style={{ color: meta.color, background: `${meta.color}1a` }}
        >
          {t(meta.labelKey)}
        </span>
      </div>

      <div className="tt-order-items">
        {order.items.map((item, i) => (
          <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
            <span className="tt-muted">{item.qty}× </span>
            {item.emoji} {item.name}
            {Object.keys(item.mods).length > 0 && (
              <span className="tt-muted" style={{ fontSize: 11 }}>
                {" "}
                (
                {Object.values(item.mods)
                  .map(v => (Array.isArray(v) ? v.join(", ") : v))
                  .join(" · ")}
                )
              </span>
            )}
            {item.notes && (
              <div className="tt-accent" style={{ fontSize: 11, fontStyle: "italic" }}>
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

      <div className="tt-row" style={{ alignItems: "center" }}>
        <strong className="tt-accent">{formatMoney(order.total, currency)}</strong>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {cancellable && onCancel && (
            <button
              className="tt-btn tt-btn-ghost tt-btn-sm"
              onClick={() => onCancel(order)}
            >
              {t("common.cancel")}
            </button>
          )}
          {action ? (
            <button
              className={`tt-btn ${action.variant} tt-btn-sm`}
              onClick={() => onAdvance(order.id, action.to)}
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
