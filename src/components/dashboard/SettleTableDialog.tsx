"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { badgesChanged } from "@/hooks/useBadges";
import WriteOffDialog from "./WriteOffDialog";
import type { WriteOffReason } from "@/lib/write-off";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
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
  tableLabel,
  currency,
  onSettled,
  canApprove,
}: SettleTableDialogProps) {
  const t = useT();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOrders(null);
    // The staff view: everything the table owes, not just this service.
    fetch(`/api/table-bill?tableId=${tableId}`)
      .then(r => (r.ok ? r.json() : { orders: [] }))
      .then(d => setOrders(d.orders ?? []))
      .catch(() => setOrders([]));
  }, [open, restaurantId, tableId]);

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
              onClick={() => setAsking(true)}
            >
              {canApprove ? t("settle.writeOff") : t("writeOff.request")}
            </button>
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
