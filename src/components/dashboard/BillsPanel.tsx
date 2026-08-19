"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Breadcrumb from "@/components/layout/Breadcrumb";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { matchesBill, type OpenBill } from "@/lib/open-bills";
import BillDiscountDialog from "./BillDiscountDialog";
import { BillIcon, SearchIcon, TableIcon } from "@/components/ui/icons";

export interface DiscountRequest {
  id: string;
  table_label: string | null;
  code: string;
  amount: number;
  requested_by: string;
}

/** A waiter asking to cancel what a table owes. */
export interface WriteOffRequest {
  id: string;
  table_label: string | null;
  amount: number;
  reason: string;
  note: string | null;
  requested_by: string;
}

/**
 * Open bills, searchable, with the promotion a manager may apply to one.
 *
 * Built like the rest of the dashboard's lists: a section per group of rows,
 * each row a line of the same height with its identity on the left and its
 * money on the right. A manager reads down the right edge to find the table
 * they were told about, so the amounts have to line up.
 */
export default function BillsPanel({
  bills,
  requests,
  writeOffs,
  currency,
  canApprove,
}: {
  bills: OpenBill[];
  requests: DiscountRequest[];
  writeOffs: WriteOffRequest[];
  currency: string;
  canApprove: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<OpenBill | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // "waiting 1h 40m" is a different sentence a minute later, so the server's
  // answer and the browser's disagree and React reports a hydration mismatch.
  // The wait is measured after mount instead — and again every half minute, so
  // a manager watching the list sees it climb rather than freeze.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const shown = useMemo(() => bills.filter(b => matchesBill(b, query)), [bills, query]);
  const owed = shown.reduce((sum, b) => sum + b.total, 0);

  async function decideWriteOff(requestId: string, approve: boolean): Promise<void> {
    setBusy(requestId);
    try {
      const res = await fetch("/api/bill/write-off/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, approve }),
      });
      const data = await res.json().catch(() => ({}));
      toast(res.ok ? t(approve ? "writeOff.done" : "dash.rejected") : (data.error ?? ""));
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function decide(requestId: string, approve: boolean): Promise<void> {
    setBusy(requestId);
    try {
      const res = await fetch("/api/bill/discount/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, approve }),
      });
      const data = await res.json();
      toast(res.ok ? t(approve ? "dash.approved" : "dash.rejected") : (data.error ?? ""));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.bills" }]}
          />
        </header>

        {/* Somebody is standing at a table waiting on these, so they lead. */}
        {(requests.length > 0 || writeOffs.length > 0) && (
          <div className="tt-section">
            <div className="tt-section-head">
              <h3 className="tt-serif" style={{ margin: 0 }}>
                {t("dash.approvals")}
              </h3>
            </div>
            {writeOffs.map(r => (
              <div key={r.id} className="tt-bill-row tt-bill-approval tt-bill-writeoff">
                <div className="tt-bill-main">
                  <strong className="tt-bill-name">
                    {r.table_label
                      ? t("dash.tableN", { label: r.table_label })
                      : t("dash.billsToGo")}
                  </strong>
                  <span className="tt-muted tt-bill-sub">
                    {t("writeOff.approvalAsk", {
                      who: r.requested_by,
                      reason: t(`writeOff.reasons.${r.reason}`),
                      amount: formatMoney(r.amount, currency),
                    })}
                  </span>
                  {r.note && (
                    <span className="tt-muted tt-bill-sub" style={{ fontStyle: "italic" }}>
                      “{r.note}”
                    </span>
                  )}
                </div>
                <div className="tt-bill-actions-row">
                  <button
                    className="tt-btn tt-btn-danger tt-btn-sm"
                    disabled={busy === r.id}
                    onClick={() => decideWriteOff(r.id, true)}
                  >
                    {t("writeOff.approve")}
                  </button>
                  <button
                    className="tt-btn tt-btn-ghost tt-btn-sm"
                    disabled={busy === r.id}
                    onClick={() => decideWriteOff(r.id, false)}
                  >
                    {t("dash.reject")}
                  </button>
                </div>
              </div>
            ))}
            {requests.map(r => (
              <div key={r.id} className="tt-bill-row tt-bill-approval">
                <div className="tt-bill-main">
                  <strong className="tt-bill-name">
                    {r.table_label
                      ? t("dash.tableN", { label: r.table_label })
                      : t("dash.billsToGo")}
                  </strong>
                  <span className="tt-muted tt-bill-sub">
                    {t("dash.approvalAsk", {
                      who: r.requested_by,
                      code: r.code,
                      amount: formatMoney(r.amount, currency),
                    })}
                  </span>
                </div>
                <div className="tt-bill-actions-row">
                  <button
                    className="tt-btn tt-btn-primary tt-btn-sm"
                    disabled={busy === r.id}
                    onClick={() => decide(r.id, true)}
                  >
                    {t("dash.approve")}
                  </button>
                  <button
                    className="tt-btn tt-btn-ghost tt-btn-sm"
                    disabled={busy === r.id}
                    onClick={() => decide(r.id, false)}
                  >
                    {t("dash.reject")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="tt-section">
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              {t("dash.bills")}
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {formatMoney(owed, currency)}
            </span>
          </div>
          <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>
            {t("dash.billsDesc")}
          </p>

          <div className="tt-bill-search">
            <SearchIcon size={16} weight="bold" />
            <input
              className="tt-input"
              value={query}
              placeholder={t("dash.billsSearch")}
              aria-label={t("dash.billsSearch")}
              onChange={e => setQuery(e.target.value)}
            />
          </div>

          {shown.length === 0 ? (
            <p className="tt-muted" style={{ marginTop: 16, marginBottom: 4 }}>
              {t("dash.billsEmpty")}
            </p>
          ) : (
            <div className="tt-bill-list">
              {shown.map(bill => (
                <button
                  key={bill.key}
                  type="button"
                  className="tt-bill-row tt-bill-open"
                  onClick={() => setChosen(bill)}
                >
                  <span className="tt-bill-glyph" aria-hidden>
                    {bill.tableLabel ? (
                      <TableIcon size={16} weight="bold" />
                    ) : (
                      <BillIcon size={16} weight="bold" />
                    )}
                  </span>
                  <span className="tt-bill-main">
                    <strong className="tt-bill-name">
                      {bill.tableLabel
                        ? t("dash.tableN", { label: bill.tableLabel })
                        : bill.code}
                    </strong>
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
              ))}
            </div>
          )}
        </div>
      </div>

      {chosen && (
        <BillDiscountDialog
          open
          bill={chosen}
          currency={currency}
          canApprove={canApprove}
          onClose={() => setChosen(null)}
          onApplied={() => router.refresh()}
        />
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
