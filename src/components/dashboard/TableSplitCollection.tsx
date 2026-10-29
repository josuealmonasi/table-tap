"use client";

import type { JSX } from "react";
import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import type { CollectedSlotReceipt } from "@/hooks/useStaffSlotReceipts";
import SplitCollection from "./SplitCollection";
import type { StaffSlotSplit } from "@/lib/split-slots-staff";

interface Props {
  canApprove: boolean; onWriteOff: (split: StaffSlotSplit) => void;
  splits: StaffSlotSplit[]; remaining: number; refresh: () => Promise<void>; onCollected: () => void; onReceipt: (receipt: CollectedSlotReceipt) => void;
}
/** Older sittings can owe too. Choose one division before choosing its parts. */
export default function TableSplitCollection({ splits, ...props }: Props): JSX.Element | null {
  const t = useT();
  const [chosen, setChosen] = useState<string | null>(null);
  const split = splits.find(s => s.id === chosen) ?? splits[0];
  if (!split) return null;
  return <>
    {splits.length > 1 && <div role="group" aria-label={t("slots.chooseBill")}>
      {splits.map((s, n) => <button key={s.id} type="button" className="tt-btn tt-btn-ghost"
        aria-pressed={s.id === split.id} onClick={() => setChosen(s.id)}>
        {t("slots.division", { n: n + 1 })} · {t("slots.progress", { paid: (s.slots ?? []).filter(p => p.paid).length, of: s.shares })}
      </button>)}
    </div>}
    <SplitCollection key={`${split.id}:${split.revision}`} split={split} {...props} />
  </>;
}
