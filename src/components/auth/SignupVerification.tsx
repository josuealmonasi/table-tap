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
  // Laid out like the sign-in card it sits beside. It used a bare label and
  // bare links: the address field sat flush on a button wider than itself, and
  // the links were the browser's default blue (layout audit, 2026-11-11).
  return <div className="tt-login"><div className="container"><div className="tt-login-card">
    <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>{t("auth.verifyTitle")}</h1>
    <p className="tt-muted" style={{ marginTop: 0 }}>{t("auth.verifyBody")}</p>
    {expired && <p className="tt-field-error" role="alert">{t("auth.verifyExpired")}</p>}
    {!initialSent && <p className="tt-field-error" role="alert">{t("auth.verificationSendFailed")}</p>}
    <form onSubmit={resend}>
      <input className="tt-input" type="email" autoComplete="email" value={email}
        placeholder={t("auth.emailPlaceholder")} aria-label={t("auth.emailPlaceholder")}
        onChange={e => setEmail(e.target.value)} style={{ marginBottom: 12 }} required />
      <button className="tt-btn tt-btn-primary" style={{ width: "100%" }} disabled={busy || !email.trim()}>
        {t(busy ? "auth.sending" : "auth.resendVerification")}
      </button>
    </form>
    {sent && <p className="tt-login-sent" role="status" style={{ marginTop: 12 }}>{t("auth.verificationResent")}</p>}
    {error && <p className="tt-field-error" role="alert">{error}</p>}
    <p className="tt-muted" style={{ fontSize: 13, marginTop: 20 }}>
      <Link href="/signup/complete" className="tt-accent">{t("auth.verificationContinue")}</Link>
    </p>
    <p className="tt-muted" style={{ fontSize: 13 }}>
      <Link href="/login" className="tt-accent">{t("auth.backToSignIn")}</Link>
    </p>
    <p className="tt-muted" style={{ fontSize: 13 }}>
      <Link href="/signup" className="tt-accent">{t("auth.verificationDifferentEmail")}</Link>
    </p>
  </div></div></div>;
}
