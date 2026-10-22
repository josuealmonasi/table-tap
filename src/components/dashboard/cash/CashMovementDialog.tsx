"use client";

import { useRef, useState } from "react";
import { useRetryIntent } from "@/hooks/useRetryIntent";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";

interface CashMovementDialogProps {
  /** A shift opened with its cash, or cash taken out; null when shut. */
  kind: "opening" | "withdrawal" | null;
  currency: string;
  shiftId?: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Opening a shift with the cash the drawer starts with, or writing down cash
 * taken out of it. One form for both: an amount, and for a withdrawal what it
 * was for.
 */
export default function CashMovementDialog({ kind, currency, shiftId, onClose, onSaved }: CashMovementDialogProps) {
  const t = useT();
  const attempt = useRetryIntent();
  const inFlight = useRef(false);
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownFor, setShownFor] = useState<typeof kind>(null);

  // Each time it opens it starts afresh.
  if (kind !== shownFor) {
    setShownFor(kind);
    setAmount("");
    setNote("");
    setError(null);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!kind || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(kind === "opening" ? "/api/cash-shift" : "/api/cash-drawer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: kind === "opening" ? JSON.stringify({ action: "open", amount })
          : attempt.body({ kind: "withdrawal", shiftId, amount, note }),
      });
      const data = await res.json();
      if (kind === "withdrawal" && ((res.ok && data.id) || (!res.ok && res.status < 500))) attempt.clear();
      if (!res.ok) {
        setError(data.error ?? t("apiErr.generic"));
        return;
      }
      if (!data.id) throw new Error("Missing movement result");
      toast(kind === "opening" ? t("shift.opened") : t("corte.withdrawalSaved"));
      onSaved();
      onClose();
    } catch {
      setError(t("done.networkError"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const title = kind === "opening" ? t("shift.openTitle") : t("corte.withdrawalTitle");
  return (
    <Modal open={kind !== null} onClose={onClose} maxWidth={420} title={title}>
      <form className="tt-prodform" onSubmit={e => void submit(e)}>
        <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
          {kind === "opening" ? t("shift.openHint") : t("corte.withdrawalHint")}
        </p>
        <label className="tt-field">
          <span className="tt-mod-label">{kind === "opening" ? t("corte.opening") : t("corte.amount")} · {currency}</span>
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
            {busy ? t("common.saving") : kind === "opening" ? t("shift.open") : t("corte.save")}
          </button>
          <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>{t("menu.cancel")}</button>
        </div>
      </form>
    </Modal>
  );
}
