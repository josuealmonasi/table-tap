"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { HELD_DISPOSITIONS, type HeldResolutionDetails, type HeldDisposition } from "@/lib/held-resolution";
import type { HeldSale } from "@/lib/offline-sales";
import type { CashMovement } from "@/lib/cash-drawer";

interface Props {
  sale: HeldSale;
  currentCurrency: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (details: HeldResolutionDetails) => Promise<void>;
}

function localTime(at: string): string {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 23) : "";
}

export default function HeldResolutionForm({ sale, currentCurrency, busy, onClose, onSubmit }: Props) {
  const t = useT();
  const [disposition, setDisposition] = useState<HeldDisposition>("retained_cash");
  const [amount, setAmount] = useState(String(sale.charge.total));
  const [reason, setReason] = useState("");
  const [collector, setCollector] = useState(sale.collector ?? "");
  const [currency, setCurrency] = useState(sale.currency ?? currentCurrency);
  const [at, setAt] = useState(localTime(sale.at));
  const [linkKind, setLinkKind] = useState("paymentId");
  const [link, setLink] = useState("");
  const [payoutId, setPayoutId] = useState("");
  const [withdrawals, setWithdrawals] = useState<CashMovement[]>([]);
  const [shiftState, setShiftState] = useState("loading");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch("/api/pos/recover/resolve", { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error("Could not read withdrawals");
        const data = await res.json();
        if (data.restaurantId !== sale.restaurantId) throw new Error("Other restaurant's withdrawals");
        if (!controller.signal.aborted) { setWithdrawals(data.withdrawals); setShiftState(data.shiftId ? "open" : "closed"); }
      } catch { if (!controller.signal.aborted) setShiftState("error"); }
    }
    void load();
    return () => controller.abort();
  }, [sale.restaurantId]);
  const noCash = disposition === "no_cash";
  const value = noCash ? 0 : Number(amount);
  const matching = withdrawals.filter(w => w.currency === currency && w.amount === value);
  const ready = reason.trim().length >= 8 && collector.trim() && at && Number.isFinite(Date.parse(at))
    && Number.isFinite(value) && value >= 0 && value <= 1_000_000 && (noCash || value > 0)
    && (disposition !== "duplicate" || /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(link))
    && (disposition !== "returned_cash" || (shiftState === "open" && matching.some(w => w.id === payoutId)));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    await onSubmit({ disposition, reason: reason.trim(), collector: collector.trim(), amount: value,
      currency: currency as "MXN" | "USD", collectedAt: new Date(at).toISOString(),
      ...(disposition === "duplicate" ? { [linkKind]: link } : {}),
      ...(disposition === "returned_cash" ? { payoutId } : {}),
    });
  }
  return <Modal open onClose={onClose} title={t("heldResolve.action")} maxWidth={540}>
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>{t("heldResolve.disposition")}</legend>
        {HELD_DISPOSITIONS.map(d => <label key={d} className="tt-field">
          <span><input type="radio" name="disposition" value={d} checked={disposition === d} onChange={() => setDisposition(d)} /> {t(`heldResolve.${d}`)}</span>
          <span className="tt-muted">{t(`heldResolve.${d}Help`)}</span>
        </label>)}
        <label className="tt-field"><span>{t("heldResolve.amount")}</span>
          <input className="tt-input" type="number" required min={0} max={1_000_000} step="0.01" disabled={noCash} value={noCash ? "0" : amount} onChange={e => setAmount(e.target.value)} />
        </label>
        <label className="tt-field"><span>{t("recovery.collector")}</span>
          <input className="tt-input" required maxLength={254} value={collector} disabled={Boolean(sale.collector)} onChange={e => setCollector(e.target.value)} />
        </label>
        <label className="tt-field"><span>{t("recovery.currency")}</span>
          <select className="tt-input" value={currency} disabled={Boolean(sale.currency)} onChange={e => setCurrency(e.target.value)}>
            {['MXN', 'USD'].map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="tt-field"><span>{t("recovery.at")}</span>
          <input className="tt-input" type="datetime-local" required step="0.001" value={at} onChange={e => setAt(e.target.value)} />
        </label>
        {disposition === "returned_cash" && <>
          {shiftState !== "open" && <p role="status">{t(shiftState === "closed" ? "apiErr.heldResolveOpenShift" : shiftState === "error" ? "done.networkError" : "common.loading")}</p>}
          <label className="tt-field"><span>{t("heldResolve.payout")}</span>
            <select className="tt-input" required value={payoutId} onChange={e => setPayoutId(e.target.value)}>
              <option value="">{t("heldResolve.choosePayout")}</option>
              {matching.map(w => <option key={w.id} value={w.id}>{formatMoney(w.amount, w.currency)} · {w.note ?? w.created_at}</option>)}
            </select>
          </label>
          {shiftState === "open" && !matching.length && <p>{t("heldResolve.recordPayout")}</p>}
        </>}
        {disposition === "duplicate" && <>
          <label className="tt-field"><span>{t("heldResolve.linkKind")}</span>
            <select className="tt-input" value={linkKind} onChange={e => setLinkKind(e.target.value)}>
              <option value="paymentId">{t("heldResolve.payment")}</option><option value="cashReceiptId">{t("heldResolve.receipt")}</option>
            </select>
          </label>
          <label className="tt-field"><span>{t("heldResolve.link")}</span><input className="tt-input" required value={link} onChange={e => setLink(e.target.value.trim())} /></label>
        </>}
        <label className="tt-field"><span>{t("heldResolve.reason")}</span>
          <textarea className="tt-input" required minLength={8} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} />
        </label>
      </fieldset>
      <button className="tt-btn tt-btn-secondary" type="submit" disabled={busy || !ready}>{t("heldResolve.submit")}</button>
    </form>
  </Modal>;
}
