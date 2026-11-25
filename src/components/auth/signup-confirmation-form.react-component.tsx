"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import { PASSWORD_MIN } from "@/lib/password";

export default function SignupConfirmationForm() {
  const t = useT();
  const [token, setToken] = useState<string | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const { hash, pathname, search } = window.location;
    const value = new URLSearchParams(hash.slice(1)).get("token");
    if (hash) window.history.replaceState(window.history.state, "", pathname + search);
    // Strict Mode runs this effect again after the fragment is gone.
    setToken(current => current === undefined ? value : current);
  }, []);

  async function confirm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    const password = new FormData(event.currentTarget).get("password");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/signup/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        window.location.assign("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? t("auth.couldNotCreate"));
    } catch {
      setError(t("done.networkError"));
    } finally {
      setBusy(false);
    }
  }

  const usable = token && /^[a-f0-9]{64}$/.test(token);
  return (
    <div className="tt-login"><div className="container"><div className="tt-login-card">
      <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>{t("auth.verifyTitle")}</h1>
      {usable ? (
        <form onSubmit={confirm}>
          <p className="tt-muted" style={{ marginTop: 0 }}>{t("auth.signupConfirmBody")}</p>
          <input className="tt-input" aria-label={t("auth.passwordMinPlaceholder")}
            name="password" type="password" autoComplete="new-password"
            placeholder={t("auth.passwordMinPlaceholder")} minLength={PASSWORD_MIN}
            style={{ marginBottom: 12 }} required />
          <button className="tt-btn tt-btn-primary" style={{ width: "100%" }} disabled={busy}>
            {t(busy ? "auth.creatingAccount" : "auth.createAccount")}
          </button>
        </form>
      ) : token !== undefined ? (
        <p className="tt-field-error" role="alert">{t("auth.signupLinkInvalid")}</p>
      ) : null}
      {error && <p className="tt-field-error" role="alert">{error}</p>}
      <p className="tt-muted" style={{ fontSize: 13, marginTop: 20 }}>
        <Link href="/login" className="tt-accent">{t("auth.backToSignIn")}</Link>
      </p>
      <p className="tt-muted" style={{ fontSize: 13 }}>
        <Link href="/signup" className="tt-accent">{t("auth.startSignupAgain")}</Link>
      </p>
    </div></div></div>
  );
}
