"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useLocale, useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { dateLocale, formatMoney } from "@/lib/format";

interface Receipt { id: string; amount: number; tip: number; currency: string; created_at: string }
interface Dish { id: string; total: number; table_label: string | null }
interface Props { receipts: Receipt[]; timeZone: string }

export default function PaymentAttribution({ receipts, timeZone }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [orders, setOrders] = useState<Dish[]>([]);
  const [busy, setBusy] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, { amount: string; tip: string }>>({});
  if (!receipts.length) return null;
  async function open(p: Receipt) {
    setBusy(true);
    try {
      const res = await fetch(`/api/payment-attribution?id=${p.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOrders(data.orders); setAmounts({}); setReceipt(p);
    } catch { toast(t("done.networkError"), "error"); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!receipt) return;
    setBusy(true);
    try {
      const entries = orders.map(o => ({ orderId: o.id, amount: Number(amounts[o.id]?.amount ?? 0), tip: Number(amounts[o.id]?.tip ?? 0) })).filter(e => e.amount > 0);
      const res = await fetch("/api/payment-attribution", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: receipt.id, entries }) });
      const data = await res.json();
      if (!res.ok) { toast(data.error, "error"); return; }
      setReceipt(null); router.refresh();
    } catch { toast(t("done.networkError"), "error"); }
    finally { setBusy(false); }
  }
  return <section className="tt-section">
    <h3>{t("attribution.title")}</h3><p className="tt-muted">{t("attribution.help")}</p>
    {receipts.map(p => <div key={p.id} className="tt-bill-row">
      <div className="tt-bill-main"><strong>{formatMoney(Number(p.amount), p.currency)}</strong>
        <span className="tt-muted tt-bill-sub">{new Date(p.created_at).toLocaleString(dateLocale(locale), { timeZone, dateStyle: "medium", timeStyle: "short" })} · {p.id.slice(0, 8)}</span></div>
      <button className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy} onClick={() => void open(p)}>{t("attribution.assign")}</button>
    </div>)}
    <Modal open={receipt !== null} onClose={() => { if (!busy) setReceipt(null); }} title={t("attribution.title")} maxWidth={560}>
      <p>{t("attribution.amount", { amount: formatMoney(Number(receipt?.amount ?? 0), receipt?.currency ?? "MXN"), tip: Number(receipt?.tip ?? 0) })}</p>
      <p className="tt-muted">{t("attribution.help")}</p>
      {orders.map(o => <div key={o.id} className="tt-section">
        <strong style={{ display: "block" }}>{o.table_label ?? o.id.slice(0, 8)} · {formatMoney(Number(o.total), receipt?.currency ?? "MXN")}</strong>
        <label className="tt-field" style={{ marginTop: 12 }}>{t("attribution.inclusive")}
          <input className="tt-input" type="number" min="0" step="0.01" value={amounts[o.id]?.amount ?? ""}
            onChange={e => setAmounts(s => ({ ...s, [o.id]: { tip: s[o.id]?.tip ?? "", amount: e.target.value } }))} /></label>
        <label className="tt-field" style={{ marginTop: 12 }}>{t("attribution.tip")}
          <input className="tt-input" type="number" min="0" step="0.01" value={amounts[o.id]?.tip ?? ""}
            onChange={e => setAmounts(s => ({ ...s, [o.id]: { amount: s[o.id]?.amount ?? "", tip: e.target.value } }))} /></label>
      </div>)}
      {!orders.length && <p>{t("returns.reviewHelp")}</p>}
      <button className="tt-btn tt-btn-primary" disabled={busy || !orders.length} onClick={() => void save()}>{t("attribution.assign")}</button>
    </Modal>
  </section>;
}
