"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { Modal } from "@/components/ui/Modal";

interface TipPickerProps {
  currency: string;
  tipPct: number;
  /** An exact amount chosen via "Other" — overrides the percentage. */
  tipCustom: number | null;
  onPresetTip: (pct: number) => void;
  onCustomTip: (amount: number | null) => void;
}

/** Tip chips (presets + "Other" with an exact-amount dialog). */
export default function TipPicker({
  currency,
  tipPct,
  tipCustom,
  onPresetTip,
  onCustomTip,
}: TipPickerProps) {
  const [asking, setAsking] = useState(false);
  const [draft, setDraft] = useState("");

  function confirmCustom(e: React.FormEvent): void {
    e.preventDefault();
    const amount = +(Number(draft) || 0).toFixed(2);
    onCustomTip(amount > 0 ? amount : null);
    setAsking(false);
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="tt-mod-label">Add a tip? 💛</div>
      <div className="tt-tip-row">
        {[0, 10, 15, 20].map(pct => (
          <button
            key={pct}
            type="button"
            className={`tt-tip-chip ${tipCustom === null && tipPct === pct ? "tt-tip-chip-active" : ""}`}
            onClick={() => onPresetTip(pct)}
          >
            {pct === 0 ? "No tip" : `${pct}%`}
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
          {tipCustom !== null ? formatMoney(tipCustom, currency) : "Other"}
        </button>
      </div>

      <Modal open={asking} onClose={() => setAsking(false)} maxWidth={360}>
        <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 8 }}>
          Tip amount
        </h3>
        <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
          How much would you like to tip?
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
              Cancel
            </button>
            <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm">
              Confirm tip
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
