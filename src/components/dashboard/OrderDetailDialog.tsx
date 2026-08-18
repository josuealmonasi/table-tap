"use client";

import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { orderCode, type Order } from "@/lib/types";
import { statusMeta } from "@/lib/order-status";
import { itemSalePrice } from "@/lib/pricing";
import { CloseIcon } from "@/components/ui/icons";

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
      <div className="tt-row" style={{ alignItems: "baseline", gap: 10 }}>
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {order.table_label
            ? t("dash.tableN", { label: order.table_label })
            : t("dash.billsToGo")}
        </h3>
        <span className="tt-order-code" style={{ marginLeft: "auto" }}>
          {orderCode(order.id)}
        </span>
        <button
          type="button"
          className="tt-icon-round"
          aria-label={t("menu.close")}
          onClick={onClose}
        >
          <CloseIcon size={16} weight="bold" />
        </button>
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
          {/* What this line put on the bill: the price it was ordered at,
              extras included. The list price would make the lines add up to
              more than the total the kitchen can see at the bottom. */}
          <span className="tt-muted" style={{ flex: "none" }}>
            {formatMoney(
              (itemSalePrice(item.price, item.discountPct) +
                (item.extras?.reduce((sum, e) => sum + e.price, 0) ?? 0)) *
                item.qty,
              currency,
            )}
          </span>
        </div>
      ))}

      {order.note && (
        <p className="tt-accent" style={{ fontSize: 13, fontStyle: "italic", marginTop: 12 }}>
          📝 {order.note}
        </p>
      )}

      {/* A promotion applied to this order stays with it: the ticket is the
          record of what was charged and why, and a total that is smaller than
          the dishes above it with nothing to explain the gap is the question
          somebody asks weeks later with no way to answer it. */}
      {Number(order.discount ?? 0) > 0 && (
        <>
          <div className="tt-row" style={{ marginTop: 14, fontSize: 14 }}>
            <span className="tt-muted">{t("totals.subtotal")}</span>
            <span className="tt-muted">
              {formatMoney(Number(order.total) + Number(order.discount), currency)}
            </span>
          </div>
          <div className="tt-row" style={{ marginTop: 4, fontSize: 14 }}>
            <span className="tt-save">
              {order.coupon_code
                ? t("totals.discountCode", { code: order.coupon_code })
                : t("totals.discount")}
            </span>
            <span className="tt-save">
              −{formatMoney(Number(order.discount), currency)}
            </span>
          </div>
        </>
      )}

      <div className="tt-row tt-total" style={{ marginTop: 14 }}>
        <span>{t("totals.total")}</span>
        <span>{formatMoney(order.total, currency)}</span>
      </div>
    </Modal>
  );
}
