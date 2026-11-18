"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { planLabel } from "@/lib/plan";

interface AdminPriceDialogProps {
  plan: string;
  current: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (newPrice: number, effectiveAt: string) => void;
}

const dayFromNow = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Schedule a plan's new monthly price, at least 31 days out so every owner gets 30 days' notice. */
export default function AdminPriceDialog({ plan, current, busy, onClose, onConfirm }: AdminPriceDialogProps) {
  const t = useT();
  const [price, setPrice] = useState(String(current));
  const [date, setDate] = useState(dayFromNow(31));
  const value = Number(price);
  const valid = Number.isFinite(value) && value > 0 && value !== current && date >= dayFromNow(31);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    // The start of that day in Mexico City.
    if (valid) onConfirm(Math.round(value * 100) / 100, `${date}T00:00:00-06:00`);
  }

  return (
    <Modal open onClose={onClose} maxWidth={460} title={t("adminPrices.dialogTitle", { plan: planLabel(plan) })}>
      <form className="tt-prodform" onSubmit={submit}>
        <p className="tt-muted" style={{ margin: 0, fontSize: 13 }}>{t("adminPrices.current", { price: formatMoney(current, "MXN") })}</p>
        <label className="tt-field">
          <span className="tt-mod-label">{t("adminPrices.newPrice")}</span>
          <input className="tt-input" type="number" inputMode="decimal" min="1" step="0.01" required value={price} onChange={e => setPrice(e.target.value)} />
        </label>
        <label className="tt-field">
          <span className="tt-mod-label">{t("adminPrices.from")}</span>
          <input className="tt-input" type="date" required value={date} min={dayFromNow(31)} onChange={e => setDate(e.target.value)} />
        </label>
        <p className="tt-muted" style={{ margin: 0, fontSize: 13 }}>{t("adminPrices.explain")}</p>
        <div className="tt-prodform-actions">
          <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy || !valid}>
            {busy ? t("common.saving") : t("adminPrices.confirm")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
