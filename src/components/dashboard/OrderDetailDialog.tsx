"use client";

import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { lineUnitPrice, orderCode, type Order } from "@/lib/types";
import { statusMeta } from "@/lib/order-status";

/**
 * The whole order, for whoever is cooking it.
 *
 * The board's card is a summary — it has to fit a column and stay scannable
 * across a busy service. When the pass needs the detail (which options, whose
 * allergy note, what the table actually owes) they open the card, and it is
 * all here without anyone hunting for a screen.
 *
 * Read-only on purpose: the buttons that move an order live on the card, where
 * the kitchen's hands already are.
 */
export default function OrderDetailDialog({
  order,
  currency,
  open,
  onClose,
}: {
  order: Order;
  currency: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const placed = new Date(order.created_at);

  return (
    <Modal open={open} onClose={onClose} maxWidth={460} label={orderCode(order.id)}>
      <div className="tt-row" style={{ alignItems: "baseline" }}>
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {order.table_label
            ? t("dash.tableN", { label: order.table_label })
            : t("dash.billsToGo")}
        </h3>
        <span className="tt-order-code">{orderCode(order.id)}</span>
      </div>
      <p className="tt-muted" style={{ fontSize: 13, margin: "4px 0 14px" }}>
        {placed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {" · "}
        {t(statusMeta(order.status).labelKey)}
      </p>

      {order.items.map((item, i) => (
        <div key={i} className="tt-order-detail-line">
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>
              {item.qty}× {item.emoji} {item.name}
            </strong>
            {Object.entries(item.mods ?? {}).map(([group, choice]) => (
              <div key={group} className="tt-muted tt-subline" style={{ fontSize: 12 }}>
                {group}: {Array.isArray(choice) ? choice.join(", ") : choice}
              </div>
            ))}
            {item.extras && item.extras.length > 0 && (
              <div className="tt-muted tt-subline" style={{ fontSize: 12 }}>
                + {item.extras.map(e => e.name).join(", ")}
              </div>
            )}
            {/* The line the kitchen most needs to read, so it keeps the accent. */}
            {item.notes && (
              <div className="tt-accent tt-subline" style={{ fontSize: 12, fontStyle: "italic" }}>
                ↳ {item.notes}
              </div>
            )}
          </div>
          <span className="tt-muted" style={{ flex: "none" }}>
            {formatMoney(lineUnitPrice(item) * item.qty, currency)}
          </span>
        </div>
      ))}

      {order.note && (
        <p className="tt-accent" style={{ fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          📝 {order.note}
        </p>
      )}

      <div className="tt-row tt-total" style={{ marginTop: 14 }}>
        <span>{t("totals.total")}</span>
        <span>{formatMoney(order.total, currency)}</span>
      </div>
    </Modal>
  );
}
