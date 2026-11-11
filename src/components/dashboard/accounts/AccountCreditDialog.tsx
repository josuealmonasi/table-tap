"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { receiptCents } from "@/lib/receipt-amount";
import { creditPreview } from "@/lib/account-credit";
import { NOTE_MAX, WRITE_OFF_REASONS, noteProblem, noteRequired, type WriteOffReason } from "@/lib/write-off";
import type { StatementCharge } from "@/lib/accounts";

interface Props {
  charge: StatementCharge; owed: number; currency: string;
  onClose: () => void; onCredited: () => void;
}
export default function AccountCreditDialog({ charge, owed, currency, onClose, onCredited }: Props) {
  const t = useT(), toast = useToast();
  const [amount, setAmount] = useState((receiptCents(charge.total) / 100).toFixed(2));
  const [reason, setReason] = useState<WriteOffReason>("error");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  const sending = useRef(false);
  const preview = creditPreview(amount, charge.total, owed);

  async function submit(): Promise<void> {
    if (sending.current || !preview || noteProblem(reason, note)) return;
    sending.current = true; setBusy(true); setError(null);
    const payload = JSON.stringify({ orderId: charge.orderId, amountCents: preview.amountCents,
      expectedCents: preview.expectedCents, reason, note: note.trim() });
    if (attempt.current?.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
    try {
      const res = await fetch("/api/accounts/credit", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...JSON.parse(payload), requestId: attempt.current.id }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? t("apiErr.generic")); return; }
      toast(t("accountCredit.done")); onCredited(); onClose();
    } catch { setError(t("done.networkError")); }
    finally { sending.current = false; setBusy(false); }
  }
  return <Modal open onClose={busy ? () => {} : onClose} maxWidth={440} title={t("accountCredit.title")}>
    {/* Each group is a field (label over its control, 6px) and the groups
        stand 16px apart. As bare inline labels, "Motivo" sat on the amount
        box above it: an inline label's margin does not push anything. */}
    <div className="tt-credit-form">
      <div className="tt-field">
        <label className="tt-mod-label" htmlFor="account-credit-amount">{t("accountCredit.amount")}</label>
        <input id="account-credit-amount" className="tt-input" inputMode="decimal" value={amount}
          disabled={busy} onChange={e => setAmount(e.target.value)} />
      </div>
      <div className="tt-field" role="group" aria-labelledby="account-credit-reason">
        <div className="tt-mod-label" id="account-credit-reason">{t("writeOff.reason")}</div>
        <div className="tt-tip-row" style={{ flexWrap: "wrap" }}>
          {WRITE_OFF_REASONS.map(key => <button key={key} type="button" disabled={busy}
            className={`tt-tip-chip ${reason === key ? "tt-tip-chip-active" : ""}`} aria-pressed={reason === key}
            onClick={() => setReason(key)}>{t(`accountCredit.${key}`)}</button>)}
        </div>
      </div>
      <div className="tt-field">
        <label className="tt-mod-label" htmlFor="account-credit-note">
          {t(noteRequired(reason) ? "writeOff.noteRequired" : "writeOff.noteOptional")}
        </label>
        <textarea id="account-credit-note" className="tt-input" maxLength={NOTE_MAX} value={note}
          disabled={busy} onChange={e => setNote(e.target.value)} />
      </div>
      {preview && <div className="tt-credit-preview">
        <p>{t("accountCredit.remaining", { amount: formatMoney(preview.remainingCents / 100, currency) })}</p>
        <p>{t("accountCredit.balance", { amount: formatMoney(preview.balanceCents / 100, currency) })}</p>
      </div>}
    </div>
    {error && <p className="tt-field-error" role="alert">{error}</p>}
    <div className="tt-bill-actions">
      <button type="button" className="tt-btn tt-btn-danger" disabled={busy || !preview || Boolean(noteProblem(reason, note))}
        onClick={submit}>{t(busy ? "writeOff.sending" : "accountCredit.confirm")}</button>
      <button type="button" className="tt-btn tt-btn-ghost" disabled={busy} onClick={onClose}>{t("writeOff.back")}</button>
    </div>
  </Modal>;
}
