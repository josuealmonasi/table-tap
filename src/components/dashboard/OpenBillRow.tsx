"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import type { OpenBill } from "@/lib/open-bills";
import { BillIcon, TableIcon } from "@/components/ui/icons";

interface OpenBillRowProps {
  bill: OpenBill;
  currency: string;
  /** The time, once the page has mounted; null before, so the server and the browser agree. */
  now: number | null;
  canSettle: boolean;
  onOpen: (bill: OpenBill) => void;
  onCollect: (bill: OpenBill) => void;
}

/** An open bill: tapped for the promotion or the close, collected separately. */
export default function OpenBillRow({
  bill,
  currency,
  now,
  canSettle,
  onOpen,
  onCollect,
}: OpenBillRowProps) {
  const t = useT();
  return (
    <div className="tt-bill-row tt-bill-open">
      {/* The row opens the promotion or the close; collecting is its own
          action, because it is the thing done most often and should not hide
          behind another dialog. */}
      <button type="button" className="tt-bill-open-main" onClick={() => onOpen(bill)}>
        <span className="tt-bill-glyph" aria-hidden>
          {bill.tableLabel ? (
            <TableIcon size={16} weight="bold" />
          ) : (
            <BillIcon size={16} weight="bold" />
          )}
        </span>
        <span className="tt-bill-main">
          <strong className="tt-bill-name">
            {bill.tableLabel ? t("dash.tableN", { label: bill.tableLabel }) : bill.code}
            {/* The name a walk-in gave, beside the code rather than instead of
                it: the code is what the screen and the diner's phone agree on,
                the name is what gets called across the room. */}
            {bill.customerName && (
              <span className="tt-bill-who"> · {bill.customerName}</span>
            )}
          </strong>
          {/* Said on the row itself, not behind a tap: the number beside it is
              what the table's orders came to, and a waiter about to take cash
              needs to know part of it is already in. A divided bill says how
              far round the table it has got; a bill the waiter has been
              collecting in parts just says how much. */}
          {bill.split ? (
            <span className="tt-badge tt-bill-split">
              {t("dash.splitting", {
                paid: bill.split.paidShares,
                of: bill.split.shares,
                amount: formatMoney(bill.collected ?? 0, currency),
              })}
            </span>
          ) : (
            (bill.collected ?? 0) > 0 && (
              <span className="tt-badge tt-bill-split">
                {t("dash.partlyPaid", {
                  amount: formatMoney(bill.collected ?? 0, currency),
                })}
              </span>
            )
          )}
          <span className="tt-muted tt-bill-sub">
            {t(
              bill.orderIds.length === 1 ? "dash.billsOrders" : "dash.billsOrdersPlural",
              { n: bill.orderIds.length },
            )}
            {now !== null && (
              <>
                {" · "}
                {t("dash.billsWaiting", { time: waited(bill.since, now) })}
              </>
            )}
          </span>
        </span>
        {bill.discounted && (
          <span className="tt-badge tt-bill-flag">{t("dash.staffOnlyBadge")}</span>
        )}
        <strong className="tt-bill-total-cell">
          {formatMoney(bill.total, currency)}
        </strong>
      </button>
      {/* For the counter order too: that is exactly where somebody is
          standing waiting to be charged. Without this the cashier saw the bill
          and had nothing to close it with. */}
      {canSettle && (
        <button
          type="button"
          className="tt-btn tt-btn-primary tt-btn-sm tt-bill-collect"
          onClick={() => onCollect(bill)}
        >
          {t("dash.collect")}
        </button>
      )}
    </div>
  );
}

/** How long the table has been sitting on this bill, in the floor's own units. */
function waited(since: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ${mins % 60}m` : `${Math.floor(hours / 24)}d`;
}
