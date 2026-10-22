"use client";

import { useRef, useState } from "react";
import { useRetryIntent, refusalSettles } from "@/hooks/useRetryIntent";
import PendingAttempt from "@/components/ui/PendingAttempt";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { typedDecimal } from "@/lib/typed-decimal";

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
/** A typed amount as money ("50" → MX$50.00); left as typed if it is not one. */
function shownMoney(typed: string | undefined, currency: string): string {
  const value = typedDecimal(typed, 2);
  return value === null ? `${typed ?? ""} ${currency}` : formatMoney(value, currency);
}

export default function CashMovementDialog({ kind, currency, shiftId, onClose, onSaved }: CashMovementDialogProps) {
  const t = useT();
  const attempt = useRetryIntent();
  const inFlight = useRef(false);
  const reviewedCurrency = useRef(currency);
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownFor, setShownFor] = useState<typeof kind>(null);

  const frozen = attempt.frozen<{ amount: string; note: string }>();
  const pending = attempt.pending();
  const shownCurrency = pending ? reviewedCurrency.current : currency;
  // Each time it opens it starts afresh, unless the withdrawal still needs an answer.
  if (kind !== shownFor) {
    setShownFor(kind);
    setAmount(frozen?.amount ?? "");
    setNote(frozen?.note ?? "");
    setError(null);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!kind || inFlight.current) return;
    if (!attempt.pending()) reviewedCurrency.current = currency;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(shownKind === "opening" ? "/api/cash-shift" : "/api/cash-drawer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: shownKind === "opening" ? JSON.stringify({ action: "open", amount })
          : attempt.body({ kind: "withdrawal", shiftId, amount, note }),
      });
      const data = await res.json();
      if (shownKind === "withdrawal" && ((res.ok && data.id) || (!res.ok && refusalSettles(res.status)))) attempt.clear();
      if (!res.ok) {
        setError(data.error ?? t("apiErr.generic"));
        return;
      }
      if (!data.id) throw new Error("Missing movement result");
      toast(shownKind === "opening" ? t("shift.opened") : t("corte.withdrawalSaved"));
      onSaved();
      onClose();
    } catch {
      setError(t("done.networkError"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // An older withdrawal must never be presented as a new drawer opening.
  const shownKind = pending && kind !== null ? "withdrawal" : kind;
  const title = shownKind === "opening" ? t("shift.openTitle") : t("corte.withdrawalTitle");
  return (
    <Modal open={kind !== null} onClose={onClose} maxWidth={420} title={title}>
      <form className="tt-prodform" onSubmit={e => void submit(e)}>
        <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
          {shownKind === "opening" ? t("shift.openHint") : t("corte.withdrawalHint")}
        </p>
        {pending && <PendingAttempt message={t("pending.withdrawal", { amount: shownMoney(frozen?.amount, shownCurrency) })} />}
        <label className="tt-field">
          <span className="tt-mod-label">{shownKind === "opening" ? t("corte.opening") : t("corte.amount")} · {shownCurrency}</span>
          <input
            className="tt-input"
            inputMode="decimal"
            disabled={busy || pending}
            value={frozen?.amount ?? amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
            required
          />
        </label>
        {shownKind === "withdrawal" && (
          <label className="tt-field">
            <span className="tt-mod-label">{t("corte.withdrawalNote")}</span>
            <input
              className="tt-input"
              disabled={busy || pending}
              value={frozen?.note ?? note}
              onChange={e => setNote(e.target.value)}
              maxLength={140}
              placeholder={t("corte.withdrawalNotePlaceholder")}
            />
          </label>
        )}
        {error && <p className="tt-field-error" role="alert">{error}</p>}
        <div className="tt-prodform-actions">
          <button type="submit" className="tt-btn tt-btn-primary" disabled={busy || !(frozen?.amount ?? amount).trim()}>
            {busy ? t("common.saving") : pending ? t("pending.sendAgain") : shownKind === "opening" ? t("shift.open") : t("corte.save")}
          </button>
          <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>{t("menu.cancel")}</button>
        </div>
      </form>
    </Modal>
  );
}
