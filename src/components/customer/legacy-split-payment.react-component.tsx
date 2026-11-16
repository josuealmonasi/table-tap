"use client";

import { useState, type JSX } from "react";
import type { SplitState } from "@/hooks/useSplit";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { splitTipBase, tipFromPercent } from "@/lib/tip-base";
import { applyPayment } from "@/lib/table-balance";
import { SEP } from "@/lib/separator";
import TipPicker from "./TipPicker";

interface Props {
  split: SplitState;
  busy: boolean;
  currency: string;
  tipPct: number;
  onPay: (tipAmount?: number) => void;
}

/** Keep old shares payable without guessing how much of their gross was food. */
export default function LegacySplitPayment({ split, busy, currency, tipPct, onPay }: Props): JSX.Element | null {
  const t = useT();
  const [customTip, setCustomTip] = useState<number | null>(null);
  const mine = split.mine;
  if (!mine) return null;
  const exactOnly = split.tipPrincipal === null;
  const total = mine.amount + split.ownSince;
  const base = splitTipBase(split.tipPrincipal ?? 0, split.shares, [mine.shareNo], split.ownTipBase ?? 0);
  const taken = applyPayment(total, total, exactOnly ? customTip ?? 0 : tipFromPercent(base, tipPct));

  function chooseNone(): void { setCustomTip(null); }
  function pay(): void { onPay(exactOnly ? taken.tip : undefined); }

  return (
    <div className="tt-split tt-split-locked">
      <strong>{t("split.yourShare")}</strong>
      <span className="tt-split-amount">{formatMoney(mine.amount, currency)}</span>
      {split.ownSince > 0 && (
        // Ordered after the table agreed, so it is this person's alone. Said
        // plainly rather than folded silently into one number: somebody who
        // orders a beer and then sees a bigger figure deserves to know why.
        <span className="tt-muted tt-split-since">
          {t("split.plusYours", { amount: formatMoney(split.ownSince, currency) })}
          {SEP}<strong>{formatMoney(total, currency)}</strong>
        </span>
      )}
      {!mine.paid && exactOnly && <>
        <p className="tt-muted">{t("split.exactTip")}</p>
        <TipPicker currency={currency} tipPct={0} tipCustom={customTip} maxTip={total} exactOnly
          onPresetTip={chooseNone} onCustomTip={setCustomTip} />
      </>}
      {!mine.paid && taken.tip > 0 && <span className="tt-muted">{t("totals.tip")} · {formatMoney(taken.tip, currency)}</span>}
      {mine.paid ? <span className="tt-split-done">{t("split.paid")}</span> : (
        <button type="button" className="tt-btn tt-btn-primary" onClick={pay} disabled={busy}>
          {t("split.payShare", { amount: formatMoney(taken.amount, currency) })}
        </button>
      )}
    </div>
  );
}
