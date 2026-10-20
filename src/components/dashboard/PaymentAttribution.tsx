"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useLocale, useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { dateLocale, formatMoney } from "@/lib/format";

interface Receipt { id: string; amount: number; tip: number; currency: string | null; created_at: string }
interface Dish { id: string; total: number; currency: string; status: string; table_label: string | null }
interface Props { receipts: Receipt[]; timeZone: string }

export default function PaymentAttribution({ receipts, timeZone }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [orders, setOrders] = useState<Dish[]>([]);
  const [currency, setCurrency] = useState("");
  const [evidence, setEvidence] = useState("");
  const [breakdownUnknown, setBreakdownUnknown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, { amount: string; tip: string }>>({});
  if (!receipts.length) return null;
  async function open(p: Receipt) {
    setBusy(true);
    try {
      const res = await fetch(`/api/payment-attribution?id=${p.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOrders(data.orders); setAmounts({}); setReceipt(p); setCurrency(p.currency ?? ""); setEvidence(""); setBreakdownUnknown(false);
    } catch { toast(t("done.networkError"), "error"); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!receipt) return;
    setBusy(true);
    try {
      const entries = orders.filter(o => o.currency === currency).map(o => ({ orderId: o.id, amount: Number(amounts[o.id]?.amount ?? 0), tip: Number(amounts[o.id]?.tip ?? 0) })).filter(e => e.amount > 0);
      const res = await fetch("/api/payment-attribution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: receipt.id, entries, currency, evidence, breakdownUnknown }) });
      const data = await res.json();
      if (!res.ok) { toast(data.error, "error"); return; }
      setReceipt(null); router.refresh();
    } catch { toast(t("done.networkError"), "error"); }
    finally { setBusy(false); }
  }
  return <section className="tt-section">
    <h3>{t("attribution.title")}</h3><p className="tt-muted">{t("attribution.help")}</p>
    {receipts.map(p => <div key={p.id} className="tt-bill-row">
      <div className="tt-bill-main"><strong>{p.currency ? formatMoney(Number(p.amount), p.currency) : `${Number(p.amount).toFixed(2)} · ${t("attribution.currencyUnknown")}`}</strong>
        <span className="tt-muted tt-bill-sub">{new Date(p.created_at).toLocaleString(dateLocale(locale), { timeZone, dateStyle: "medium", timeStyle: "short" })} · {p.id.slice(0, 8)}</span></div>
      <button className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy} onClick={() => void open(p)}>{t("attribution.assign")}</button>
    </div>)}
    <Modal open={receipt !== null} onClose={() => { if (!busy) setReceipt(null); }} title={t("attribution.title")} maxWidth={560}>
      <p>{t("attribution.amount", { amount: currency ? formatMoney(Number(receipt?.amount ?? 0), currency) : Number(receipt?.amount ?? 0).toFixed(2), tip: Number(receipt?.tip ?? 0) })}</p>
      <p className="tt-muted">{t("attribution.help")}</p>
      <label className="tt-field">{t("attribution.currency")}
        <select className="tt-input" value={currency} onChange={e => setCurrency(e.target.value)} disabled={!!receipt?.currency}>
          <option value="">{t("attribution.chooseCurrency")}</option>
          {[...new Set([...(receipt?.currency ? [receipt.currency] : []), ...orders.map(o => o.currency)])].map(code => <option key={code} value={code}>{code}</option>)}
        </select>
      </label>
      <label className="tt-field">{t("attribution.evidence")}
        <input className="tt-input" value={evidence} maxLength={500} onChange={e => setEvidence(e.target.value)} />
      </label>
      <label><input type="checkbox" checked={breakdownUnknown} onChange={e => setBreakdownUnknown(e.target.checked)} /> {t("attribution.unknownTip")}</label>
      {orders.filter(o => !currency || o.currency === currency).map(o => <div key={o.id} className="tt-section">
        <strong style={{ display: "block" }}>{o.table_label ?? o.id.slice(0, 8)} · {formatMoney(Number(o.total), o.currency)}</strong>
        {o.status === "cancelled" && <p className="tt-muted">{t("attribution.cancelled")}</p>}
        <label className="tt-field" style={{ marginTop: 12 }}>{t("attribution.inclusive")}
          <input className="tt-input" type="number" min="0" step="0.01" value={amounts[o.id]?.amount ?? ""}
            onChange={e => setAmounts(s => ({ ...s, [o.id]: { tip: s[o.id]?.tip ?? "", amount: e.target.value } }))} /></label>
        <label className="tt-field" style={{ marginTop: 12 }}>{t("attribution.tip")}
          <input className="tt-input" type="number" min="0" step="0.01" value={amounts[o.id]?.tip ?? ""}
            onChange={e => setAmounts(s => ({ ...s, [o.id]: { amount: s[o.id]?.amount ?? "", tip: e.target.value } }))} /></label>
      </div>)}
      {!orders.length && <p>{t("returns.reviewHelp")}</p>}
      <button className="tt-btn tt-btn-primary" disabled={busy || !orders.length || !currency || evidence.trim().length < 8} onClick={() => void save()}>{t("attribution.assign")}</button>
    </Modal>
  </section>;
}
