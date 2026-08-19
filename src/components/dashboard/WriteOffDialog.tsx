"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { NOTE_MAX, WRITE_OFF_REASONS, noteRequired, type WriteOffReason } from "@/lib/write-off";

/**
 * Cancelling what a table owes, with a reason attached.
 *
 * The reason is a short fixed list rather than a free-text box, so a month of
 * these can be counted: "MX$3,400 lost to walkouts" is something an owner can
 * act on. The note beside it carries the part no list can predict, and is
 * required only for "other" — a write-off nobody can explain later is exactly
 * what this record exists to prevent.
 *
 * A waiter sees the same form with a different button: theirs is an ask, and
 * the wording says so before they fill anything in, not after they submit.
 */
export default function WriteOffDialog({
  open,
  onClose,
  amount,
  currency,
  canApprove,
  busy,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  /** What cancelling this costs the restaurant. */
  amount: number;
  currency: string;
  /** Owner or manager: their word is final. A waiter is asking. */
  canApprove: boolean;
  busy: boolean;
  onSubmit: (reason: WriteOffReason, note: string) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState<WriteOffReason>("walkout");
  const [note, setNote] = useState("");

  const missingNote = noteRequired(reason) && note.trim().length === 0;

  return (
    <Modal open={open} onClose={onClose} maxWidth={440} label={t("writeOff.title")}>
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 4 }}>
        {canApprove ? t("writeOff.title") : t("writeOff.askTitle")}
      </h3>
      <p className="tt-muted tt-subline" style={{ fontSize: 13, marginTop: 0 }}>
        {canApprove ? t("writeOff.body") : t("writeOff.askBody")}
      </p>

      <div className="tt-writeoff-amount tt-row">
        <span className="tt-muted">{t("writeOff.amount")}</span>
        <strong style={{ fontSize: 18 }}>{formatMoney(amount, currency)}</strong>
      </div>

      <div className="tt-mod-label" style={{ marginTop: 16 }}>
        {t("writeOff.reason")}
      </div>
      <div className="tt-tip-row" style={{ flexWrap: "wrap" }}>
        {WRITE_OFF_REASONS.map(key => (
          <button
            key={key}
            type="button"
            className={`tt-tip-chip ${reason === key ? "tt-tip-chip-active" : ""}`}
            aria-pressed={reason === key}
            onClick={() => setReason(key)}
          >
            {t(`writeOff.reasons.${key}`)}
          </button>
        ))}
      </div>

      <label className="tt-mod-label" htmlFor="tt-writeoff-note" style={{ marginTop: 16 }}>
        {noteRequired(reason) ? t("writeOff.noteRequired") : t("writeOff.noteOptional")}
      </label>
      <textarea
        id="tt-writeoff-note"
        className="tt-input"
        style={{ width: "100%", minHeight: 72, resize: "vertical" }}
        maxLength={NOTE_MAX}
        placeholder={t("writeOff.notePlaceholder")}
        value={note}
        onChange={e => setNote(e.target.value)}
      />

      <div className="tt-bill-actions">
        <button
          className="tt-btn tt-btn-danger tt-btn-lg"
          style={{ width: "100%" }}
          disabled={busy || missingNote}
          onClick={() => onSubmit(reason, note.trim())}
        >
          {busy
            ? t("writeOff.sending")
            : canApprove
              ? t("writeOff.confirm")
              : t("writeOff.request")}
        </button>
        <button
          className="tt-btn tt-btn-ghost"
          style={{ width: "100%", marginTop: 8 }}
          disabled={busy}
          onClick={onClose}
        >
          {t("writeOff.back")}
        </button>
      </div>
    </Modal>
  );
}
