"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";

/** Sets a new password using the recovery session established by /auth/callback. */
export default function ResetPasswordForm() {
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // null = still checking, false = no valid recovery session, true = ready.
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (active) setReady(Boolean(data.user));
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (password !== confirm) {
      setError(t("auth.passwordsMismatch"));
      return;
    }
    setLoading(true);
    setError("");
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Hard navigate so the server picks up the refreshed session.
    window.location.assign("/dashboard");
  }

  return (
    <div className="tt-login">
      <div className="container">
        {ready === false ? (
          <div className="tt-login-card">
            <div style={{ fontSize: 32 }}>⌛</div>
            <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>
              {t("auth.linkExpired")}
            </h1>
            <p className="tt-muted" style={{ marginTop: 0 }}>
              {t("auth.linkInvalid")}
            </p>
            <p className="tt-muted" style={{ fontSize: 13, marginTop: 20 }}>
              <Link href="/forgot-password" className="tt-accent">
                {t("auth.requestNewLink")}
              </Link>
            </p>
          </div>
        ) : (
          <form className="tt-login-card" onSubmit={handleSubmit}>
            <div style={{ fontSize: 32 }}>🔒</div>
            <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>
              {t("auth.chooseNewTitle")}
            </h1>
            <p className="tt-muted" style={{ marginTop: 0 }}>
              {t("auth.chooseNewSub")}
            </p>

            <input
              className="tt-input"
              type="password"
              placeholder={t("auth.newPasswordPlaceholder")}
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ marginBottom: 12 }}
              minLength={6}
              required
            />
            <input
              className="tt-input"
              type="password"
              placeholder={t("auth.confirmPasswordPlaceholder")}
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              style={{ marginBottom: 12 }}
              minLength={6}
              required
            />
            <button
              className="tt-btn tt-btn-primary"
              style={{ width: "100%" }}
              disabled={password.length < 6 || confirm.length < 6 || loading || ready === null}
              type="submit"
            >
              {loading ? t("auth.saving") : t("auth.updatePassword")}
            </button>

            {error && <p className="tt-field-error">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
