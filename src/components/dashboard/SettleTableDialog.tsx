"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { badgesChanged } from "@/hooks/useBadges";
import WriteOffDialog from "./WriteOffDialog";
import TableCalculator from "./TableCalculator";
import SettleBillLines from "./SettleBillLines";
import type { WriteOffReason } from "@/lib/write-off";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
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
  /** Opens the promotion dialog on this bill, where the screen has one. */
  onDiscount?: () => void;
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
  onDiscount,
}: SettleTableDialogProps) {
  const t = useT();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  // The calculator, for a table paying a bit at a time.
  const [inParts, setInParts] = useState(false);

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
    } catch {
      // No catch at all until now: offline this threw straight past the toast
      // and the dialog just sat there, so the bill looked untouched and the
      // person had no idea whether they had asked for it twice.
      toast(t("offline.blocked"), "error");
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
      // Money, so this never queues: a settlement replayed on reconnect is a
      // table charged twice. Refuse it and say why.
      toast(t("offline.blocked"), "error");
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
        open={open && !asking && !inParts}
        onClose={onClose}
        maxWidth={460}
        label={t("settle.open")}
      >
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
        {/* A counter order is not a table: calling it "Mesa ORD-E2EC" leads
            with the one thing it does not have. */}
        {t(tableId ? "settle.title" : "settle.titleToGo", { label: tableLabel })}
      </h3>

      {!bill ? (
        <p className="tt-muted">{t("common.loading")}</p>
      ) : bill.settled ? (
        <p className="tt-muted">{t("settle.nothing")}</p>
      ) : (
        <>
          <SettleBillLines bill={bill} currency={currency} />

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
            {/* Tables only: a counter order is one person at a till paying
                for one thing, and offering to divide it is offering something
                nobody standing there has ever asked for. */}
            {tableId && (
              <button
                className="tt-btn tt-btn-ghost tt-btn-lg"
                style={{ width: "100%", marginTop: 8 }}
                disabled={busy}
                onClick={() => setInParts(true)}
              >
                {t("settle.parts")}
              </button>
            )}
            {/* Last, and quiet: a table that walks out is the exception, and
                the board filling with debts nobody can clear is worse than
                admitting one was never paid.

                Tables only: a counter order nobody collected is cancelled on
                the board, which already asks for a reason, rather than through
                a path here that assumes a table. */}
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
      {tableId && (
        <TableCalculator
          open={inParts}
          onClose={() => {
            setInParts(false);
            onClose();
          }}
          tableId={tableId}
          tableLabel={tableLabel}
          currency={currency}
          onCollected={onSettled}
          onDiscount={onDiscount}
        />
      )}
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
