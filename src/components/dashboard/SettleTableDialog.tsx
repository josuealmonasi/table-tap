"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatMoney } from "@/lib/format";
import { tableBill } from "@/lib/table-bill";
import type { Order } from "@/lib/types";

interface SettleTableDialogProps {
  open: boolean;
  onClose: () => void;
  restaurantId: string;
  tableId: string;
  tableLabel: string;
  currency: string;
  /** Refreshes the board once the table is settled. */
  onSettled: () => void;
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
  tableLabel,
  currency,
  onSettled,
}: SettleTableDialogProps) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOrders(null);
    fetch(`/api/bill?restaurantId=${restaurantId}&tableId=${tableId}`)
      .then(r => (r.ok ? r.json() : { orders: [] }))
      .then(d => setOrders(d.orders ?? []))
      .catch(() => setOrders([]));
  }, [open, restaurantId, tableId]);

  // The waiter is settling the whole table, so nothing here is "mine".
  const bill = orders ? tableBill(orders, []) : null;

  async function settle(settlement: "cash" | "card" | "written_off"): Promise<void> {
    if (settlement === "written_off") {
      const ok = await confirm({
        title: t("settle.writeOffConfirm"),
        message: t("settle.writeOffMsg"),
        confirmLabel: t("settle.writeOff"),
        danger: true,
      });
      if (!ok) return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/table-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, settlement }),
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
    <Modal open={open} onClose={onClose} maxWidth={460} label={t("settle.open")}>
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
        {t("settle.title", { label: tableLabel })}
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
                admitting one was never paid. */}
            <button
              className="tt-btn tt-btn-ghost tt-btn-sm"
              style={{ width: "100%", marginTop: 12 }}
              disabled={busy}
              onClick={() => settle("written_off")}
            >
              {t("settle.writeOff")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
