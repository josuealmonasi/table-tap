"use client";

import type { JSX } from "react";
import { useRef, useState } from "react";
import SplitSlotSelector, { freeSelection } from "@/components/split/SplitSlotSelector";
import CashChange from "./CashChange";
import TipPicker from "@/components/customer/TipPicker";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import { tipFor } from "@/lib/pricing";
import { newRef } from "@/lib/collection-ref";
import type { StaffSlotSplit } from "@/lib/split-slots-staff";

interface Props { split: StaffSlotSplit; remaining: number; refresh: () => Promise<void>; onCollected: () => void }
/** Both staff doors choose the same parts and send the same reviewed cents. */
export default function SplitCollection({ split, remaining, refresh, onCollected }: Props): JSX.Element {
  const t = useT();
  const [selected, setSelected] = useState<number[]>([]);
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const request = useRef<{ body: string; ref: string } | null>(null);
  const slots = split.slots ?? [];
  const chosen = freeSelection(slots, selected);
  const cents = chosen.reduce((sum, s) => sum + s.amountCents, 0);
  const amount = cents / 100;
  const tip = tipCustom ?? tipFor(amount, tipPct);
  const tooMuch = !Number.isFinite(tip) || tip < 0 || tip > amount;
  const currency = split.currency ?? "MXN";
  const scope = { restaurantId: split.restaurantId, tableId: split.tableId, sessionId: split.sessionId,
    splitId: split.id, revision: split.revision };

  async function send(cancel: boolean, method?: "cash" | "card"): Promise<void> {
    if (sending.current || (!cancel && (cents <= 0 || tooMuch))) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const reviewed = { ...scope, ...(!cancel && { slots: chosen.map(s => s.shareNo),
        expectedCents: cents, currency, tipCents: Math.round(tip * 100), method }) };
      const body = JSON.stringify(reviewed);
      // A retry after losing the answer is the same collection, not more cash.
      if (request.current?.body !== body) request.current = { body, ref: newRef() };
      const res = await fetch(`/api/split/${cancel ? "cancel" : "collect"}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...reviewed, ...(!cancel && { ref: request.current.ref }) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? t("settle.failed"));
      else {
        setSelected([]); setTipPct(0); setTipCustom(null); request.current = null;
        onCollected();
      }
      // Taken, paid, reserved and stale all mean the list may have changed.
      await refresh();
    } catch { setError(t("done.networkError")); }
    finally { sending.current = false; setBusy(false); }
  }
  return <section data-split-model="2" aria-label={t("slots.collect")}>
    <strong>{t("slots.progress", { paid: slots.filter(s => s.paid).length, of: split.shares })}</strong>
    <p>{t("slots.remaining", { amount: formatMoney(remaining, currency) })}</p>
    {error && <p className="tt-field-error" role="alert">{error}</p>}
    <SplitSlotSelector slots={slots} selected={selected} currency={currency} busy={busy} onChange={setSelected} />
    <TipPicker currency={currency} tipPct={tipPct} tipCustom={tipCustom} maxTip={amount}
      onPresetTip={pct => { setTipPct(pct); setTipCustom(null); }} onCustomTip={setTipCustom} />
    {tooMuch && <p role="alert">{t("tip.tooLarge", { max: formatMoney(amount, currency) })}</p>}
    <CashChange amount={amount + (tooMuch ? 0 : tip)} currency={currency} />
    <div className="tt-bill-actions">
      <button type="button" className="tt-btn tt-btn-primary" disabled={busy || cents <= 0 || tooMuch} onClick={() => send(false, "cash")}>
        {t("settle.cash")} · {formatMoney(amount + (tooMuch ? 0 : tip), currency)}
      </button>
      <button type="button" className="tt-btn tt-btn-ghost" disabled={busy || cents <= 0 || tooMuch} onClick={() => send(false, "card")}>
        {t("settle.card")} · {formatMoney(amount + (tooMuch ? 0 : tip), currency)}
      </button>
    </div>
    {split.frozen ? <p className="tt-muted">{t("slots.frozen")}</p>
      : <button type="button" className="tt-btn tt-btn-ghost" disabled={busy} onClick={() => send(true)}>{t("slots.cancel")}</button>}
  </section>;
}
