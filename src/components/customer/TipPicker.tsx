"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { tipFor } from "@/lib/pricing";
import { useT } from "@/lib/i18n/context";
import { Modal } from "@/components/ui/Modal";

interface TipPickerProps {
  currency: string;
  tipPct: number;
  /** An exact amount chosen via "Other" — overrides the percentage. */
  tipCustom: number | null;
  /**
   * The most this order can be tipped — the discounted subtotal, which is
   * what priceCart caps an exact tip at. Passed in so the chip shows what
   * will actually be charged: it used to show the typed figure, so a
   * mistyped MX$10,000 on a MX$1,445 bill displayed as MX$10,000 while the
   * total quietly used MX$1,416.20.
   */
  maxTip: number;
  onPresetTip: (pct: number) => void;
  onCustomTip: (amount: number | null) => void;
}

/** Tip chips (presets + "Other" with an exact-amount dialog). */
export default function TipPicker({
  currency,
  tipPct,
  tipCustom,
  maxTip,
  onPresetTip,
  onCustomTip,
}: TipPickerProps) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState("");

  function confirmCustom(e: React.FormEvent): void {
    e.preventDefault();
    // Clamped here as well as in priceCart. The engine is what protects the
    // charge; this is what keeps the screen honest about it.
    //
    // Deliberately not a `max` on the input: that blocks submission with the
    // browser's own message, which follows the browser's language rather than
    // the one the diner chose here. The limit is stated above the field in
    // our copy instead, and anything larger folds down to it.
    const amount = Math.min(+(Number(draft) || 0).toFixed(2), maxTip);
    onCustomTip(amount > 0 ? amount : null);
    setAsking(false);
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="tt-mod-label">{t("tip.prompt")}</div>
      <div className="tt-tip-row">
        {[0, 10, 15, 20].map(pct => (
          <button
            key={pct}
            type="button"
            className={`tt-tip-chip ${tipCustom === null && tipPct === pct ? "tt-tip-chip-active" : ""}`}
            onClick={() => onPresetTip(pct)}
          >
            {pct === 0 ? t("tip.none") : `${pct}%`}
            {/* A percentage is not an amount, and the diner is deciding how
                much to give — "15%" of a bill they have not added up is a
                number they cannot feel. The figure comes from the same
                function that charges it, on the same base, so the chip and
                the total can never disagree. Nothing to print on a cart worth
                nothing, and 0% of anything is not news. */}
            {pct > 0 && maxTip > 0 && (
              <span className="tt-tip-amount">
                {formatMoney(tipFor(maxTip, pct), currency)}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          className={`tt-tip-chip ${tipCustom !== null ? "tt-tip-chip-active" : ""}`}
          onClick={() => {
            setDraft(tipCustom !== null ? String(tipCustom) : "");
            setAsking(true);
          }}
        >
          {tipCustom !== null
            ? formatMoney(Math.min(tipCustom, maxTip), currency)
            : t("tip.other")}
        </button>
      </div>

      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        maxWidth={360}
        label={t("tip.amountTitle")}
      >
        <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 8 }}>
          {t("tip.amountTitle")}
        </h3>
        <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
          {t("tip.amountPrompt")}
        </p>
        <p className="tt-muted" style={{ marginTop: 0, fontSize: 12 }}>
          {t("tip.max", { max: formatMoney(maxTip, currency) })}
        </p>
        <form onSubmit={confirmCustom}>
          <input
            className="tt-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            placeholder="0.00"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            required
          />
          <div
            style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}
          >
            <button
              type="button"
              className="tt-btn tt-btn-ghost tt-btn-sm"
              onClick={() => setAsking(false)}
            >
              {t("tip.cancel")}
            </button>
            <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm">
              {t("tip.confirm")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
