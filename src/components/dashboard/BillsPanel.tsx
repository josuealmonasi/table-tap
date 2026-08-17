"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

/**
 * Open bills, searchable, with the discount a manager may apply to one.
 *
 * The list is what a manager needs when a waiter says "table four is asking
 * about the membership promotion": find four, see what they owe, apply it.
 * Requests waiting on a decision sit at the top, because somebody is standing
 * at a table waiting for the answer.
 */
export default function BillsPanel({
  bills,
  requests,
  currency,
  canApprove,
}: {
  bills: OpenBill[];
  requests: DiscountRequest[];
  currency: string;
  canApprove: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<OpenBill | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const shown = useMemo(() => bills.filter(b => matchesBill(b, query)), [bills, query]);

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
    <div className="tt-panel">
      <h2 className="tt-serif">{t("dash.bills")}</h2>
      <p className="tt-muted tt-subline">{t("dash.billsDesc")}</p>

      {requests.length > 0 && (
        <div className="tt-card" style={{ padding: 14, marginTop: 14 }}>
          <div className="tt-mod-label">{t("dash.approvals")}</div>
          {requests.map(r => (
            <div key={r.id} className="tt-row" style={{ marginTop: 10, gap: 10 }}>
              <span style={{ fontSize: 14 }}>
                {t("dash.approvalAsk", {
                  who: r.requested_by,
                  code: r.code,
                  amount: formatMoney(r.amount, currency),
                  table: r.table_label
                    ? t("dash.tableN", { label: r.table_label })
                    : t("dash.billsToGo"),
                })}
              </span>
              <span style={{ display: "flex", gap: 8, flex: "none" }}>
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
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="tt-search-row" style={{ marginTop: 16 }}>
        <SearchIcon size={16} weight="bold" />
        <input
          className="tt-input"
          style={{ width: "100%" }}
          value={query}
          placeholder={t("dash.billsSearch")}
          aria-label={t("dash.billsSearch")}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <p className="tt-muted" style={{ marginTop: 16 }}>
          {t("dash.billsEmpty")}
        </p>
      ) : (
        <div style={{ marginTop: 12 }}>
          {shown.map(bill => (
            <button
              key={bill.key}
              type="button"
              className="tt-card tt-open-table"
              style={{ width: "100%", marginTop: 10, padding: 14 }}
              onClick={() => setChosen(bill)}
            >
              <span className="tt-row">
                <span>
                  <strong>
                    {bill.tableLabel ? (
                      <>
                        <TableIcon size={14} weight="bold" />{" "}
                        {t("dash.tableN", { label: bill.tableLabel })}
                      </>
                    ) : (
                      <>
                        <BillIcon size={14} weight="bold" /> {bill.code}
                      </>
                    )}
                  </strong>
                  <span className="tt-muted tt-subline" style={{ display: "block", fontSize: 13 }}>
                    {t(bill.orderIds.length === 1 ? "dash.billsOrders" : "dash.billsOrdersPlural", {
                      n: bill.orderIds.length,
                    })}
                    {bill.discounted ? ` · ${t("dash.staffOnlyBadge")}` : ""}
                  </span>
                </span>
                <strong className="tt-accent">{formatMoney(bill.total, currency)}</strong>
              </span>
            </button>
          ))}
        </div>
      )}

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
