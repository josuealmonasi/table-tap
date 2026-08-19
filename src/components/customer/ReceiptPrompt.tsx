"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { Modal } from "@/components/ui/Modal";
import { EMAIL_MAX, isValidEmail } from "@/lib/email";

/**
 * Offers a receipt by email, once, after paying.
 *
 * Easy to leave: the backdrop closes it, Escape closes it, and there is a
 * plain "no thanks" — somebody who has just paid is on their way out, and a
 * question they cannot dismiss is a question that gets remembered as an
 * annoyance rather than a service.
 *
 * The promise under the field is the whole design. An address given for a
 * receipt is given for a receipt: no account, no list, no second message. It
 * is written where the typing happens because that is where it is decided,
 * not in a policy nobody opens.
 */
export default function ReceiptPrompt({
  orderIds,
  open,
  onClose,
}: {
  /** One order, or every order a table settled at once. */
  orderIds: string[];
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  // Only complain once they have stopped typing something plausible: a red
  // line appearing on the first keystroke reads as being told off for typing.
  const [touched, setTouched] = useState(false);
  const valid = isValidEmail(email);
  const showInvalid = touched && email.trim().length > 0 && !valid;

  async function send(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t("notice.generic"));
        setBusy(false);
        return;
      }
      setSent(true);
    } catch {
      setError(t("notice.network"));
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={400} label={t("receipt.askTitle")}>
      {sent ? (
        <>
          <h3 className="tt-serif" style={{ marginTop: 0 }}>
            {t("receipt.sentTitle")}
          </h3>
          <p className="tt-muted" style={{ fontSize: 14 }}>
            {t("receipt.sentBody", { email })}
          </p>
          <button
            className="tt-btn tt-btn-primary"
            style={{ width: "100%", marginTop: 16 }}
            onClick={onClose}
          >
            {t("receipt.done")}
          </button>
        </>
      ) : (
        <form onSubmit={send}>
          <h3 className="tt-serif" style={{ marginTop: 0 }}>
            {t("receipt.askTitle")}
          </h3>
          <p className="tt-muted" style={{ fontSize: 14, marginTop: 0 }}>
            {t("receipt.askBody")}
          </p>

          <input
            className="tt-input"
            style={{ width: "100%", marginTop: 12 }}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={t("receipt.placeholder")}
            aria-label={t("receipt.placeholder")}
            maxLength={EMAIL_MAX}
            value={email}
            onChange={e => setEmail(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showInvalid}
          />

          {showInvalid && (
            <p className="tt-receipt-error" role="alert">
              {t("receipt.badEmail")}
            </p>
          )}

          <p className="tt-receipt-promise">{t("receipt.promise")}</p>

          {error && (
            <p className="tt-receipt-error" role="alert">
              {error}
            </p>
          )}

          <button
            className="tt-btn tt-btn-primary"
            style={{ width: "100%", marginTop: 14 }}
            type="submit"
            disabled={busy || !valid}
          >
            {busy ? t("receipt.sending") : t("receipt.send")}
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-ghost"
            style={{ width: "100%", marginTop: 6 }}
            onClick={onClose}
          >
            {t("receipt.noThanks")}
          </button>
        </form>
      )}
    </Modal>
  );
}
