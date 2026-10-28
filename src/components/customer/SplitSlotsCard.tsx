"use client";

import type { JSX } from "react";
import TipPicker from "./TipPicker";
import { tipFor } from "@/lib/pricing";
import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import type { SplitState } from "@/hooks/useSplit";
import SplitSlotSelector, { freeSelection } from "@/components/split/SplitSlotSelector";

interface Props {
  split: SplitState; outstanding: number; diner: string; busy: boolean; cardsEnabled: boolean;
  onPay: (slots?: number[], tipCents?: number) => void; cancel: () => Promise<void>;
  resize?: (people: number) => Promise<void>;
}
export default function SplitSlotsCard({ split, outstanding, diner, busy, cardsEnabled, onPay, cancel, resize }: Props): JSX.Element {
  const t = useT();
  const [selected, setSelected] = useState<number[]>([]);
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  const slots = split.slots ?? [];
  const chosen = freeSelection(slots, selected);
  const cents = chosen.reduce((sum, s) => sum + s.amountCents, 0);
  const currency = split.currency ?? "MXN";
  const tip = tipCustom ?? tipFor(cents / 100, tipPct);
  const tooMuch = !Number.isFinite(tip) || tip < 0 || tip > cents / 100;
  const below = cents > 0 && cents < (currency === "USD" ? 50 : 1000);
  return <div className="tt-split" data-split-model="2">
    <strong>{t("slots.progress", { paid: slots.filter(s => s.paid).length, of: split.shares })}</strong>
    <p>{t("slots.remaining", { amount: formatMoney(outstanding, currency) })}</p>
    {split.resumptions?.map(resume => <div key={resume.slots.join(",")}>
      <p>{t("slots.resumeParts", { parts: resume.slots.map(n => n + 1).join(", "), amount: formatMoney(resume.amountCents / 100, currency) })}
        {" · "}{t("pending.tip", { amount: formatMoney(resume.tipCents / 100, currency) })}</p>
      <button type="button" className="tt-btn tt-btn-primary" disabled={busy}
        onClick={() => onPay(resume.slots, resume.tipCents)}>{t("slots.resume")}</button>
    </div>)}
    <SplitSlotSelector slots={slots} selected={selected} currency={currency} busy={busy} onChange={setSelected} />
    {cardsEnabled ? <>
      <TipPicker currency={currency} tipPct={tipPct} tipCustom={tipCustom} maxTip={cents / 100}
        onPresetTip={pct => { setTipPct(pct); setTipCustom(null); }} onCustomTip={setTipCustom} />
      {tooMuch && <p role="alert">{t("tip.tooLarge", { max: formatMoney(cents / 100, currency) })}</p>}
      {below && <p role="status">{t("slots.minimum")}</p>}
      <button type="button" className="tt-btn tt-btn-primary" disabled={busy || cents <= 0 || below || tooMuch}
        onClick={() => onPay(chosen.map(s => s.shareNo), Math.round(tip * 100))}>
        {t("slots.pay", { amount: formatMoney(cents / 100 + (tooMuch ? 0 : tip), currency) })}
      </button>
    </> : <p className="tt-muted">{t("slots.askWaiter")}</p>}
    {split.frozen ? <p className="tt-muted">{t("slots.frozen")}</p> : split.proposedBy === diner && <>
      {resize && <label>{t("split.people")}
        <select className="tt-input" value={split.shares} disabled={busy} onChange={e => resize(Number(e.target.value))}>
          {Array.from({ length: 19 }, (_, n) => n + 2).map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>}
      <button type="button" className="tt-btn tt-btn-ghost" disabled={busy} onClick={cancel}>{t("slots.cancel")}</button>
    </>}
  </div>;
}
