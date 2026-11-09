"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";

interface Props { initialEmail?: string; initialSent?: boolean; expired?: boolean }

/** Keep a usable way back when mail is delayed or a confirmation link expires. */
export default function SignupVerification({ initialEmail = "", initialSent = true, expired = false }: Props) {
  const t = useT();
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function resend(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true); setError(""); setSent(false);
    try {
      const res = await fetch("/api/signup/resend", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t("auth.verificationSendFailed"));
        return;
      }
      setSent(true);
    } catch { setError(t("done.networkError")); }
    finally { setBusy(false); }
  }
  return <div className="tt-login"><div className="container"><div className="tt-login-card">
    <h1 className="tt-serif">{t("auth.verifyTitle")}</h1>
    <p>{t("auth.verifyBody")}</p>
    {expired && <p role="alert">{t("auth.verifyExpired")}</p>}
    {!initialSent && <p role="alert">{t("auth.verificationSendFailed")}</p>}
    <form onSubmit={resend}>
      <label className="tt-field">
        <span>{t("auth.emailPlaceholder")}</span>
        <input className="tt-input" type="email" autoComplete="email" value={email}
          onChange={e => setEmail(e.target.value)} required />
      </label>
      <button className="tt-btn tt-btn-primary" disabled={busy || !email.trim()}>
        {t(busy ? "auth.sending" : "auth.resendVerification")}
      </button>
    </form>
    {sent && <p role="status">{t("auth.verificationResent")}</p>}
    {error && <p className="tt-field-error" role="alert">{error}</p>}
    <p><Link href="/signup/complete">{t("auth.verificationContinue")}</Link></p>
    <p><Link href="/login">{t("auth.backToSignIn")}</Link></p>
    <p><Link href="/signup">{t("auth.verificationDifferentEmail")}</Link></p>
  </div></div></div>;
}
