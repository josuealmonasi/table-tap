"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { cashSuggestions, changeFor } from "@/lib/cash-change";

interface CashChangeProps {
  /** What is being collected in cash, tip included. */
  amount: number;
  currency: string;
}

/**
 * "Recibido" and the change to hand back, for whoever takes cash.
 *
 * Optional and display only: nothing here is sent or saved, so the sale still
 * records the amount owed and the corte counts what it always has. Used on
 * every screen that takes cash, so the till, the table and the customer
 * account work it out the same way.
 */
export default function CashChange({ amount, currency }: CashChangeProps) {
  const t = useT();
  const [received, setReceived] = useState("");
  const value = Number(received.replace(",", "."));
  const typed = received.trim() !== "" && Number.isFinite(value) && value >= 0;
  const result = typed ? changeFor(amount, value) : null;
  const pick = (v: number): void => setReceived(String(v));

  return (
    <div className="tt-cash-change">
      <label className="tt-field">
        <span className="tt-mod-label">
          {t("change.received")} <span className="tt-muted">{t("common.optional")}</span>
        </span>
        <input
          className="tt-input"
          inputMode="decimal"
          value={received}
          onChange={e => setReceived(e.target.value)}
          placeholder={formatMoney(amount, currency)}
          aria-describedby="cash-change-result"
        />
      </label>
      <div className="tt-tip-row">
        <button type="button" className="tt-tip-chip" onClick={() => pick(amount)}>
          {t("change.exact")}
        </button>
        {cashSuggestions(amount, currency).map(v => (
          <button type="button" key={v} className="tt-tip-chip" onClick={() => pick(v)}>
            {formatMoney(v, currency)}
          </button>
        ))}
      </div>
      <p id="cash-change-result" role="status" aria-live="polite" className="tt-cash-change-result">
        {result &&
          (result.short > 0
            ? t("change.short", { amount: formatMoney(result.short, currency) })
            : t("change.give", { amount: formatMoney(result.change, currency) }))}
      </p>
    </div>
  );
}
