"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { canPayMineOnly, ordersToPay, type TableBill } from "@/lib/table-bill";
import type { BillSide } from "@/lib/table-bill";

interface BillSheetProps {
  open: boolean;
  onClose: () => void;
  bill: TableBill;
  restaurantId: string;
  tableId: string;
  tableLabel: string;
  currency: string;
}

/** One side of the bill — this phone's food, or the rest of the table's. */
function Side({
  heading,
  side,
  currency,
}: {
  heading: string;
  side: BillSide;
  currency: string;
}) {
  if (side.orders.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="tt-row">
        <strong>{heading}</strong>
        <strong className="tt-accent">{formatMoney(side.total, currency)}</strong>
      </div>
      {side.items.map((item, i) => (
        <div key={i} className="tt-muted tt-subline" style={{ fontSize: 13 }}>
          {item.qty}× {item.emoji} {item.name}
        </div>
      ))}
    </div>
  );
}

/**
 * What the table owes, and the three ways to settle it.
 *
 * This is the only place a dine-in bill is paid, whether the diner settles
 * straight after ordering or once they are done. One screen means one
 * settlement path, and money moving in one place is money that can only go
 * wrong in one place.
 */
export default function BillSheet({
  open,
  onClose,
  bill,
  restaurantId,
  tableId,
  tableLabel,
  currency,
}: BillSheetProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [called, setCalled] = useState(false);

  async function payOnline(scope: "all" | "mine"): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/bill/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId,
          tableId,
          // Which orders, not how much: the amount is summed from the stored
          // rows on the server.
          orderIds: ordersToPay(bill, scope).map(o => o.id),
        }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  /** Brings a waiter over to take cash or a card at the table. */
  async function payAtTable(): Promise<void> {
    setBusy(true);
    try {
      await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, tableId, kind: "pay" }),
      });
      setCalled(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={460} label={t("bill.open")}>
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
        {t("bill.title", { label: tableLabel })}
      </h3>

      {bill.settled ? (
        <p className="tt-muted">{t("bill.empty")}</p>
      ) : (
        <>
          <Side heading={t("bill.yours")} side={bill.mine} currency={currency} />
          <Side
            heading={t("bill.othersAtTable")}
            side={bill.others}
            currency={currency}
          />

          <div className="tt-bill-total tt-row">
            <strong>{t("bill.total")}</strong>
            <strong style={{ fontSize: 18 }}>{formatMoney(bill.total, currency)}</strong>
          </div>

          {called ? (
            // Nothing more to press: a waiter is coming, and offering to pay
            // online now would invite paying twice for the same food.
            <div className="tt-bill-called" role="status">
              <strong>{t("bill.called")}</strong>
              <p className="tt-muted tt-subline" style={{ fontSize: 13, margin: 0 }}>
                {t("bill.calledBody")}
              </p>
            </div>
          ) : (
            // Not .tt-cart-actions: that is the cart panel's sticky footer,
            // and inside a modal it floats over the total rather than sitting
            // under it.
            <div className="tt-bill-actions">
              <button
                className="tt-btn tt-btn-primary tt-btn-lg"
                style={{ width: "100%" }}
                disabled={busy}
                onClick={() => payOnline("all")}
              >
                {t("bill.payAll", { amount: formatMoney(bill.total, currency) })}
              </button>

              {/* Only when somebody else is on the bill: alone, this and "pay
                  everything" are the same act. */}
              {canPayMineOnly(bill) && (
                <button
                  className="tt-btn tt-btn-ghost tt-btn-lg"
                  style={{ width: "100%", marginTop: 8 }}
                  disabled={busy}
                  onClick={() => payOnline("mine")}
                >
                  {t("bill.payMine", { amount: formatMoney(bill.mine.total, currency) })}
                </button>
              )}

              <button
                className="tt-btn tt-btn-ghost tt-btn-lg"
                style={{ width: "100%", marginTop: 8 }}
                disabled={busy}
                onClick={payAtTable}
              >
                {busy ? t("bill.calling") : t("bill.payAtTable")}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
