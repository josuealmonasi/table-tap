"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale, formatMoney } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { RefundDueRow } from "@/lib/refund-due";

interface RefundsDueProps {
  refunds: RefundDueRow[];
  /** A connected Stripe account, which is where the refund is made. */
  canRefund: boolean;
}

/**
 * Card payments that arrived for a bill already collected, and the button that
 * gives each back.
 *
 * A waiter took cash for the table while a diner was paying by card: the card
 * money is real and is the diner's. It used to be a line in the bell telling
 * the owner to refund it in Stripe, which nothing here could see done, and a
 * refund made there kept our fee. Refunding from here returns the fee too,
 * and the row stays until the customer and our fee have both been paid back.
 *
 * Owner and manager only — the page passes none to anybody else, and the route
 * refuses them.
 */
export default function RefundsDue({ refunds, canRefund }: RefundsDueProps) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (refunds.length === 0) return null;

  function originalAmount(row: RefundDueRow): string {
    return row.currency ? `${formatMoney(Number(row.amount), row.currency)} · ${row.currency}`
      : `${Number(row.amount).toFixed(2)} · ${t("refunds.currencyUnknown")}`;
  }

  async function refund(row: RefundDueRow): Promise<void> {
    const amount = originalAmount(row);
    const ok = await confirm({
      title: t(row.refunded_at ? "refunds.retryFee" : "refunds.confirmTitle", { amount }),
      message: t(row.refunded_at ? "refunds.feePending" : "refunds.confirmBody"),
      confirmLabel: t(row.refunded_at ? "refunds.retryFee" : "refunds.refund"),
    });
    if (!ok) return;
    setBusy(row.id);
    try {
      const res = await fetch("/api/refunds-due", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? t("done.networkError"), "error");
      } else {
        toast(data.feePending ? t("refunds.feePending") : data.alreadyInStripe ? t("refunds.doneInStripe") : t("refunds.done", { amount }));
      }
      router.refresh();
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("refunds.title")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("refunds.intro")}
        </span>
      </div>
      {refunds.map(r => (
        <div key={r.id} className="tt-bill-row tt-bill-approval">
          <div className="tt-bill-main">
            <strong className="tt-bill-name">{originalAmount(r)}</strong>
            <span className="tt-muted tt-bill-sub">
              {r.refunded_at && <>{t("refunds.feePending")}{" · "}</>}
              {r.account_name
                ? t("refunds.account", { name: r.account_name })
                : r.table_label ? t("refunds.table", { label: r.table_label }) : t("refunds.counter")}
              {" · "}
              {new Date(r.created_at).toLocaleString(dateLocale(locale), {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <div className="tt-bill-actions-row">
            {(canRefund || r.refunded_at) ? (
              <button
                type="button"
                className="tt-btn tt-btn-primary tt-btn-sm"
                disabled={busy === r.id}
                onClick={() => void refund(r)}
              >
                {t(r.refunded_at ? "refunds.retryFee" : "refunds.refund")}
              </button>
            ) : (
              <span className="tt-muted tt-bill-sub">{t("refunds.needsStripe")}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
