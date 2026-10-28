"use client";
import { useState } from "react";
import { useT, useLocale } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { dateLocale, formatMoney } from "@/lib/format";
import { useOfflineSales } from "@/hooks/useOfflineSales";
import { reviewSale, type QueuedOfflineSale } from "@/lib/offline-review";
import { orderCode } from "@/lib/types";
import type { RecoveryDetails } from "./RecoveryForm";
import RecoveryReview from "./RecoveryReview";
import { useHeldSales } from "@/hooks/useHeldSales";

interface Props { restaurantId: string; currency: string }

export default function HeldSales({ restaurantId, currency }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const offline = useOfflineSales(restaurantId);
  const [history, setHistory] = useState(false);
  const [page, setPage] = useState(0);
  const { rows, pendingCount, loading, error, hasMore, reload, refreshPending } = useHeldSales(restaurantId, history, page);
  const [selected, setSelected] = useState<QueuedOfflineSale | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendLocal() {
    setBusy(true);
    try { await offline.flush(); await refreshPending(); }
    finally { setBusy(false); }
  }

  async function recover(details: RecoveryDetails) {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const sale = reviewSale(selected, restaurantId);
      const res = await fetch("/api/pos/recover", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posRef: selected.pos_ref, restaurantId, approval: { ...details, confirmed: true } }) });
      const data = await res.json();
      if (!res.ok) { toast(data.error ?? t("done.networkError"), "error"); return; }
      if (data.settled !== true || data.orderId !== selected.pos_ref || Number(data.total) !== sale.charge.total
        || data.currency !== details.currency || data.method !== sale.method || data.onAccount) {
        toast(t("pos.saleMismatch", { collected: sale.charge.total, settled: data.total ?? "—" }), "error"); return;
      }
      setSelected(null); await refreshPending(); toast(t("recovery.done"));
    } catch { toast(t("done.networkError"), "error"); }
    finally { setBusy(false); }
  }

  return <>
    <section className="tt-section"><p>{t("recovery.intro")}</p><p className="tt-muted">{t("recovery.deviceOnly")}</p>
      <div role="group" aria-label={t("heldSalesView.views")} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button className="tt-btn tt-btn-secondary" aria-pressed={!history} onClick={() => setHistory(false)}>
          {t("heldSalesView.pending", { count: pendingCount ?? "—" })}
        </button>
        <button className="tt-btn tt-btn-secondary" aria-pressed={history} onClick={() => { setPage(0); setHistory(true); }}>{t("heldSalesView.history")}</button>
      </div>
      {offline.held.length > 0 && <div role="status"><p>{t("recovery.local", { count: offline.held.length })}</p>
        {offline.held.map(s => <p key={s.posRef}>{orderCode(s.posRef)} · {s.error}</p>)}
        <button className="tt-btn tt-btn-secondary" disabled={busy} onClick={sendLocal}>{t("recovery.send")}</button>
      </div>}
      {loading && <p role="status">{t("common.loading")}</p>}
      {error && <p role="alert">{t("done.networkError")} <button className="tt-btn tt-btn-secondary" onClick={() => void reload()}>{t("recovery.reload")}</button></p>}
      {!loading && !error && !rows.length && <p>{t(history ? "heldSalesView.emptyHistory" : "recovery.empty")}</p>}
      {rows.map(row => {
        const sale = reviewSale(row, restaurantId);
        return <div key={row.pos_ref} className="tt-bill-row tt-bill-approval">
          <div className="tt-bill-main"><strong>{orderCode(row.pos_ref)} · {sale.currency ? formatMoney(sale.charge.total, sale.currency) : sale.charge.total.toFixed(2)} {sale.currency ?? ""}</strong>
            <span className="tt-muted tt-bill-sub">{row.approved_at ? t("recovery.approved", { by: row.approved_by ?? "", at: new Date(row.approved_at).toLocaleString(dateLocale(locale)) }) : t(row.reason)}</span>
            <span className="tt-muted tt-bill-sub">{row.collector ?? t("recovery.legacyCollector")}</span></div>
          {!row.approved_at && <button className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy} onClick={() => setSelected(row)}>{t("recovery.review")}</button>}
        </div>;
      })}
      {history && <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <button className="tt-btn tt-btn-secondary" disabled={loading || page === 0} onClick={() => setPage(p => p - 1)}>{t("heldSalesView.previous")}</button>
        <span>{t("heldSalesView.page", { page: page + 1 })}</span>
        <button className="tt-btn tt-btn-secondary" disabled={loading || error || !hasMore} onClick={() => setPage(p => p + 1)}>{t("heldSalesView.next")}</button>
      </div>}
    </section>
    {selected && <RecoveryReview key={selected.pos_ref} sale={reviewSale(selected, restaurantId)} currentCurrency={currency} busy={busy}
      onClose={() => { if (!busy) setSelected(null); }} onSubmit={details => void recover(details)} />}
  </>;
}
