"use client";

import type { JSX } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import type { SplitSlot } from "@/lib/split-slots";

interface Props {
  slots: SplitSlot[]; selected: number[]; currency: string; busy?: boolean;
  onChange: (slots: number[]) => void;
}
/** A part can be chosen only while it is free, on the phone and at the till. */
export default function SplitSlotSelector({ slots, selected, currency, busy = false, onChange }: Props): JSX.Element {
  const t = useT();
  return <fieldset style={{ border: 0, padding: 0, margin: "12px 0", minWidth: 0 }}>
    <legend>{t("slots.choose")}</legend>
    {slots.map(slot => <label key={slot.shareNo} data-split-slot={slot.shareNo}
      style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "10px 0", overflowWrap: "anywhere" }}>
      <input type="checkbox" disabled={busy || slot.paid || slot.paying}
        checked={!slot.paid && !slot.paying && selected.includes(slot.shareNo)}
        onChange={e => onChange(e.target.checked ? [...selected, slot.shareNo].sort((a, b) => a - b) : selected.filter(n => n !== slot.shareNo))} />
      <span>{t("slots.part", { n: slot.shareNo + 1 })} · {formatMoney(slot.amountCents / 100, currency)}
        {" · "}<strong>{t(slot.paid ? "slots.paid" : slot.paying ? "slots.held" : "slots.free")}</strong></span>
    </label>)}
  </fieldset>;
}

/** Ignore a choice that another payer has since taken; never charge a stale total. */
export function freeSelection(slots: SplitSlot[], selected: number[]): SplitSlot[] {
  return slots.filter(s => selected.includes(s.shareNo) && !s.paid && !s.paying);
}
