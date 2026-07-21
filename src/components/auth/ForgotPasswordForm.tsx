"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";

/** Requests a password-reset email. Never reveals whether the email exists. */
export default function ForgotPasswordForm() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    // The email link returns to /auth/callback, which establishes the session
    // and forwards to the reset form.
    await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    // Always show the same confirmation, whether or not the account exists.
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="tt-login">
      <div className="container">
        {sent ? (
          <div className="tt-login-card">
            <div style={{ fontSize: 32 }}>📬</div>
            <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>
              {t("auth.checkEmail")}
            </h1>
            <p className="tt-muted" style={{ marginTop: 0 }}>
              {t("auth.resetSentBefore")}
              <strong>{email.trim()}</strong>
              {t("auth.resetSentAfter")}
            </p>
            <p className="tt-muted" style={{ fontSize: 13, marginTop: 20 }}>
              <Link href="/login" className="tt-accent">
                {t("auth.backToSignIn")}
              </Link>
            </p>
          </div>
        ) : (
          <form className="tt-login-card" onSubmit={handleSubmit}>
            <div style={{ fontSize: 32 }}>🔑</div>
            <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>
              {t("auth.resetTitle")}
            </h1>
            <p className="tt-muted" style={{ marginTop: 0 }}>
              {t("auth.resetSub")}
            </p>

            <input
              className="tt-input"
              type="email"
              placeholder={t("auth.emailPlaceholder")}
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ marginBottom: 12 }}
              required
            />
            <button
              className="tt-btn tt-btn-primary"
              style={{ width: "100%" }}
              disabled={!email.trim() || loading}
              type="submit"
            >
              {loading ? t("auth.sending") : t("auth.sendResetLink")}
            </button>

            <p className="tt-muted" style={{ fontSize: 13, marginTop: 20 }}>
              {t("auth.rememberedIt")}{" "}
              <Link href="/login" className="tt-accent">
                {t("auth.signIn")}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
