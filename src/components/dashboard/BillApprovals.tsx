"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { badgesChanged } from "@/hooks/useBadges";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";

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

interface BillApprovalsProps {
  requests: DiscountRequest[];
  writeOffs: WriteOffRequest[];
  currency: string;
}

/** What the floor asked a manager to decide: a debt cancelled, a promotion applied. */
export default function BillApprovals({
  requests,
  writeOffs,
  currency,
}: BillApprovalsProps) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

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
      if (res.ok) {
        // One fewer thing waiting on a decision.
        badgesChanged();
        router.refresh();
      }
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
      if (res.ok) badgesChanged();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (requests.length === 0 && writeOffs.length === 0) return null;
  const where = (label: string | null) =>
    label ? t("dash.tableN", { label }) : t("dash.billsToGo");

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("dash.approvals")}
        </h3>
      </div>
      {writeOffs.map(r => (
        <div key={r.id} className="tt-bill-row tt-bill-approval tt-bill-writeoff">
          <div className="tt-bill-main">
            <strong className="tt-bill-name">{where(r.table_label)}</strong>
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
            <strong className="tt-bill-name">{where(r.table_label)}</strong>
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
  );
}
