"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { badgesChanged } from "@/hooks/useBadges";
import WriteOffDialog from "./WriteOffDialog";
import type { WriteOffReason } from "@/lib/write-off";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { PAID_LINES_SHOWN } from "@/lib/table-bill";
import { tableBill } from "@/lib/table-bill";
import type { Order } from "@/lib/types";

interface SettleTableDialogProps {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  /** The table being collected on, or null for a general-QR order. */
  tableId: string | null;
  /** The counter order being collected, when there is no table. */
  orderId?: string | null;
  tableLabel: string;
  currency: string;
  /** Refreshes the board once the table is settled. */
  onSettled: () => void;
  /** Owner or manager — a waiter may ask to cancel a bill, not cancel it. */
  canApprove: boolean;
}

/**
 * What a table owes, and how the waiter closes it.
 *
 * The waiter is standing at the table with a card reader or a handful of cash,
 * so this is deliberately short: what they ordered, what to collect, and three
 * buttons. The amounts come from the same `tableBill` the diner saw, so the
 * two cannot disagree about what is owed.
 */
export default function SettleTableDialog({
  open,
  onClose,
  restaurantId,
  tableId,
  orderId = null,
  tableLabel,
  currency,
  onSettled,
  canApprove,
}: SettleTableDialogProps) {
  const t = useT();
  const toast = useToast();
  // Folded by default: what was paid is reference, the total is what they came for.
  const [showPaid, setShowPaid] = useState(false);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOrders(null);
    // The staff view: everything the table owes, not just this service.
    fetch(tableId ? `/api/table-bill?tableId=${tableId}` : `/api/table-bill?orderId=${orderId}`)
      .then(r => (r.ok ? r.json() : { orders: [] }))
      .then(d => setOrders(d.orders ?? []))
      .catch(() => setOrders([]));
  }, [open, restaurantId, tableId, orderId]);

  // The waiter is settling the whole table, so nothing here is "mine".
  const bill = orders ? tableBill(orders, []) : null;

  async function writeOff(reason: WriteOffReason, note: string): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/bill/write-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, reason, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? t("settle.failed"), "error");
        return;
      }
      // A waiter's is an ask: say so plainly rather than let them walk away
      // believing the table is cleared when it still owes.
      // A waiter's ask just joined the manager's queue.
      badgesChanged();
      toast(data.pending ? t("writeOff.sent") : t("writeOff.done"));
      setAsking(false);
      onSettled();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function settle(settlement: "cash" | "card"): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/table-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tableId ? { tableId, settlement } : { orderId, settlement }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error ?? t("settle.failed"), "error");
        return;
      }
      toast(t("settle.done"));
      onSettled();
      onClose();
    } catch {
      toast(t("settle.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* One dialog at a time. Asking why a bill is being cancelled replaces
          the settle sheet rather than stacking over it — two open dialogs trap
          focus against each other and take two Escapes to leave. */}
      <Modal
        open={open && !asking}
        onClose={onClose}
        maxWidth={460}
        label={t("settle.open")}
      >
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
        {/* Un pedido de mostrador no es una mesa: llamarlo "Mesa ORD-E2EC"
            le pone delante lo único que no tiene. */}
        {t(tableId ? "settle.title" : "settle.titleToGo", { label: tableLabel })}
      </h3>

      {!bill ? (
        <p className="tt-muted">{t("common.loading")}</p>
      ) : bill.settled ? (
        <p className="tt-muted">{t("settle.nothing")}</p>
      ) : (
        <>
          <div className="tt-mod-label">{t("settle.items")}</div>
          {bill.others.items.concat(bill.mine.items).map((item, i) => (
            <div key={i} className="tt-muted tt-subline" style={{ fontSize: 13 }}>
              {item.qty}× {item.emoji} {item.name}
            </div>
          ))}

          {/* Lo que alguien de la mesa ya pagó con tarjeta. Va aparte y sin
              sumar: el mesero necesita saber que ese plato no se cobra, y
              esconderlo es justo lo que lleva a cobrarlo dos veces. */}
          {bill.paid.orders.length > 0 && (
            <div className="tt-bill-settled" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="tt-mod-label tt-paid-toggle"
                aria-expanded={showPaid}
                onClick={() => setShowPaid(v => !v)}
              >
                {t("settle.alreadyPaid", {
                  amount: formatMoney(bill.paid.total, currency),
                })}
                {bill.paid.items.length > PAID_LINES_SHOWN && (
                  <span className="tt-muted">
                    {" "}
                    {t(showPaid ? "settle.hideLines" : "settle.showLines", {
                      n: bill.paid.items.length,
                    })}
                  </span>
                )}
              </button>
              {(showPaid ? bill.paid.items : bill.paid.items.slice(0, PAID_LINES_SHOWN)).map(
                (item, i) => (
                  <div key={i} className="tt-muted tt-subline" style={{ fontSize: 13 }}>
                    {item.qty}× {item.emoji} {item.name}
                  </div>
                ),
              )}
            </div>
          )}

          <div className="tt-bill-total tt-row">
            <strong>{t("settle.total")}</strong>
            <strong style={{ fontSize: 18 }}>{formatMoney(bill.total, currency)}</strong>
          </div>

          <div className="tt-bill-actions">
            <button
              className="tt-btn tt-btn-primary tt-btn-lg"
              style={{ width: "100%" }}
              disabled={busy}
              onClick={() => settle("cash")}
            >
              {t("settle.cash")}
            </button>
            <button
              className="tt-btn tt-btn-ghost tt-btn-lg"
              style={{ width: "100%", marginTop: 8 }}
              disabled={busy}
              onClick={() => settle("card")}
            >
              {t("settle.card")}
            </button>
            {/* Last, and quiet: a table that walks out is the exception, and
                the board filling with debts nobody can clear is worse than
                admitting one was never paid.

                Sólo para mesas: un pedido de mostrador que nadie recogió se
                cancela en el tablero, que ya pregunta el motivo, en vez de
                cancelarse aquí por una vía que asume una mesa. */}
            {tableId && <button
              className="tt-btn tt-btn-ghost tt-btn-sm"
              style={{ width: "100%", marginTop: 12 }}
              disabled={busy}
              onClick={() => setAsking(true)}
            >
              {canApprove ? t("settle.writeOff") : t("writeOff.request")}
            </button>}
          </div>
        </>
      )}
      </Modal>
      {bill && (
        <WriteOffDialog
          open={asking}
          onClose={() => setAsking(false)}
          amount={bill.total}
          currency={currency}
          canApprove={canApprove}
          busy={busy}
          onSubmit={writeOff}
        />
      )}
    </>
  );
}
