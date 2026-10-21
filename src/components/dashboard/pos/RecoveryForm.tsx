"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { orderCode } from "@/lib/types";
import SaleBreakdown from "./SaleBreakdown";
import type { OfflineComparison } from "@/lib/offline-comparison";
import type { HeldSale } from "@/lib/offline-sales";

export interface RecoveryDetails { reason: string; collector?: string; at: string; currency: string }
export interface RecoveryFormProps { comparison?: OfflineComparison | null; comparing?: boolean; sale: HeldSale; currentCurrency: string; busy: boolean; onClose: () => void; onSubmit: (details: RecoveryDetails) => void }

function localInput(at: string): string {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
}

export default function RecoveryForm({ sale, currentCurrency, busy, onClose, onSubmit, comparison = null, comparing = false }: RecoveryFormProps) {
  const t = useT();
  const [collector, setCollector] = useState(sale.collector ?? "");
  const [currency, setCurrency] = useState(sale.currency ?? currentCurrency);
  const [at, setAt] = useState(localInput(sale.at));
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const matchesCurrency = currency === currentCurrency;
  const ready = !comparing && confirmed && reason.trim().length >= 8 && at && (sale.collectorContext || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(collector));
  return <Modal open onClose={onClose} title={t("recovery.review")} maxWidth={540}>
    <p><strong>{orderCode(sale.posRef)} · {formatMoney(sale.charge.total, currency)} · {currency}</strong></p>
    <p>{t("recovery.preserve")}</p>
    {sale.error && <p>{t(sale.error)}</p>}
    <p>{t(sale.method === "cash" ? "returns.cash" : "returns.terminal")}</p>
    <h4>{t("recovery.savedBreakdown")}</h4>
    <SaleBreakdown items={sale.items} charge={sale.charge} currency={currency} />
    {comparing ? <p role="status">{t("common.loading")}</p> : comparison && comparison.currency === currency ? <>
      <h4>{t("recovery.todayMenu")}</h4>
      <SaleBreakdown items={comparison.lines} charge={comparison.charge} currency={comparison.currency} />
      <p>{t("recovery.priceDifference", { amount: formatMoney(comparison.difference, comparison.currency) })}</p>
    </> : <p role="status">{t("recovery.cannotCompare")}</p>}
    <label className="tt-field"><span>{t("recovery.collector")}</span>
      <input className="tt-input" type="email" value={collector} maxLength={254} disabled={Boolean(sale.collectorContext)} onChange={e => setCollector(e.target.value)} />
    </label>
    <p className="tt-muted">{t(sale.collectorContext ? "recovery.signedCollector" : "recovery.legacyCollector")}</p>
    <label className="tt-field"><span>{t("recovery.currency")}</span>
      <select className="tt-input" disabled={Boolean(sale.currency)} value={currency} onChange={e => setCurrency(e.target.value)}>
        {['MXN', 'USD'].map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
    {!matchesCurrency && <p className="tt-field-error">{t("recovery.restoreCurrency", { currency })}</p>}
    <label className="tt-field"><span>{t("recovery.at")}</span>
      <input className="tt-input" type="datetime-local" step="0.001" value={at} onChange={e => setAt(e.target.value)} />
    </label>
    <p className="tt-muted">{t("recovery.originalAt", { at: sale.at })}</p>
    <label className="tt-field"><span>{t("recovery.reason")}</span>
      <textarea className="tt-input" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />
    </label>
    <label className="tt-field" style={{ margin: "16px 0" }}>
      <span><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> {t("recovery.confirm")}</span>
    </label>
    <button type="button" className="tt-btn tt-btn-primary" disabled={busy || !ready}
      onClick={() => onSubmit({ reason: reason.trim(), collector: collector.trim() || undefined, at: new Date(at).toISOString(), currency })}>{t("recovery.approve")}</button>
  </Modal>;
}
