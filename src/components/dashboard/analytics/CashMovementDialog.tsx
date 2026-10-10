"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";

interface CashMovementDialogProps {
  /** What is being written down, or null when the dialog is shut. */
  kind: "opening" | "withdrawal" | null;
  /** The opening already set, to start the field from. */
  opening?: number;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Writing down the drawer's float, or cash taken out of it. One form for
 * both: an amount, and for a withdrawal what it was for.
 */
export default function CashMovementDialog({ kind, opening, onClose, onSaved }: CashMovementDialogProps) {
  const t = useT();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownFor, setShownFor] = useState<typeof kind>(null);

  // Each time it opens it starts afresh — from today's opening when that is
  // what is being changed.
  if (kind !== shownFor) {
    setShownFor(kind);
    setAmount(kind === "opening" && opening ? opening.toFixed(2) : "");
    setNote("");
    setError(null);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cash-drawer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, amount, note: kind === "withdrawal" ? note : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t("apiErr.generic"));
        return;
      }
      toast(kind === "opening" ? t("corte.openingSaved") : t("corte.withdrawalSaved"));
      onSaved();
      onClose();
    } catch {
      setError(t("done.networkError"));
    } finally {
      setBusy(false);
    }
  }

  const title = kind === "opening" ? t("corte.openingTitle") : t("corte.withdrawalTitle");
  return (
    <Modal open={kind !== null} onClose={onClose} maxWidth={420} title={title}>
      <form className="tt-prodform" onSubmit={e => void submit(e)}>
        <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
          {kind === "opening" ? t("corte.openingHint") : t("corte.withdrawalHint")}
        </p>
        <label className="tt-field">
          <span className="tt-mod-label">{t("corte.amount")}</span>
          <input
            className="tt-input"
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
            required
          />
        </label>
        {kind === "withdrawal" && (
          <label className="tt-field">
            <span className="tt-mod-label">{t("corte.withdrawalNote")}</span>
            <input
              className="tt-input"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={140}
              placeholder={t("corte.withdrawalNotePlaceholder")}
            />
          </label>
        )}
        {error && <p className="tt-field-error" role="alert">{error}</p>}
        <div className="tt-prodform-actions">
          <button type="submit" className="tt-btn tt-btn-primary" disabled={busy || !amount.trim()}>
            {busy ? t("common.saving") : t("corte.save")}
          </button>
          <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>{t("menu.cancel")}</button>
        </div>
      </form>
    </Modal>
  );
}
