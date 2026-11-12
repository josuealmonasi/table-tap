"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useCardEmail } from "@/hooks/useCardEmail";
import CardEmailFields from "./CardEmailFields.react-component";

interface CardEmailProps {
  code: string;
  diner?: boolean;
  initialEmail?: string | null;
  disabled?: boolean;
}

/** Key by code at the caller: consent from one diner must never follow the next card. */
export default function CardEmail({ code, diner = false, initialEmail, disabled = false }: CardEmailProps) {
  const t = useT();
  const { data, error: readError, mutate, publish } = useCardEmail(diner ? null : code);
  const [ownEmail, setOwnEmail] = useState(initialEmail);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = diner ? ownEmail : data?.email;

  async function save(remove = false): Promise<void> {
    if (busy || disabled || (!remove && (!email.trim() || !consent))) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/loyalty/card-email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, email: remove ? null : email.trim(), consent: !remove && consent }),
        signal: AbortSignal.timeout(10_000),
      });
      const answer = await res.json();
      if (!res.ok) {
        setError(res.status === 409 && answer.outcome === "taken" && typeof answer.suffix === "string"
          ? t(diner ? "cardEmail.takenDiner" : "cardEmail.taken", { suffix: answer.suffix })
          : t(res.status === 400 ? "cardEmail.invalid" : "cardEmail.failed"));
        return;
      }
      if (answer.outcome !== "removed" && answer.outcome !== "saved") throw new Error("Missing save outcome");
      const next = answer.outcome === "removed" ? null : answer.email;
      if (next !== null && typeof next !== "string") throw new Error("Missing saved email");
      if (diner) setOwnEmail(next);
      else await publish({ email: next });
      setEditing(false); setEmail(""); setConsent(false);
    } catch { setError(t("cardEmail.failed")); }
    finally { setBusy(false); }
  }

  return <fieldset disabled={busy || disabled} style={{ border: 0, padding: 0, margin: "12px 0", minWidth: 0 }}>
    <legend>{t("cardEmail.title")}</legend>
    {linked !== undefined ? <p style={{ overflowWrap: "anywhere" }}>{linked || t("cardEmail.none")}</p>
      : <p className="tt-muted">{t(diner ? "cardEmail.ownReadFailed" : readError ? "cardEmail.readFailed" : "common.loading")}</p>}
    {readError && <p role="alert" className="tt-field-error">{t("cardEmail.readFailed")}</p>}
    {readError && <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => void mutate()}>{t("settle.retry")}</button>}
    {editing ? <>
      <CardEmailFields email={email} consent={consent} onEmail={setEmail} onConsent={setConsent} diner={diner} />
      <button type="button" className="tt-btn tt-btn-primary tt-btn-sm" disabled={!email.trim() || !consent}
        onClick={e => { if (e.currentTarget.parentElement?.querySelector("input")?.reportValidity()) void save(); }}>{t("cardEmail.save")}</button>
      <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => { setEditing(false); setEmail(""); setConsent(false); setError(null); }}>{t("common.cancel")}</button>
    </> : <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => { setEmail(""); setConsent(false); setEditing(true); }}>{t("cardEmail.edit")}</button>}
    {linked && <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => void save(true)}>{t("cardEmail.remove")}</button>}
    {error && <p className="tt-field-error" role="alert">{error}</p>}
  </fieldset>;
}
