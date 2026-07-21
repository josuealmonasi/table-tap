"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";

/** Email + password sign in for restaurant staff. Redirects to /dashboard. */
export default function LoginForm() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Hard navigate so the server picks up the fresh auth cookies.
    window.location.assign("/dashboard");
  }

  return (
    <div className="tt-login">
      <div className="container">
        <form className="tt-login-card" onSubmit={handleSubmit}>
          <div style={{ fontSize: 32 }}>🌸</div>
          <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>
            {t("auth.welcomeBack")}
          </h1>
          <p className="tt-muted" style={{ marginTop: 0 }}>
            {t("auth.signInSub")}
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
          <input
            className="tt-input"
            type="password"
            placeholder={t("auth.passwordPlaceholder")}
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ marginBottom: 12 }}
            required
          />
          <button
            className="tt-btn tt-btn-primary"
            style={{ width: "100%" }}
            disabled={!email || !password || loading}
            type="submit"
          >
            {loading ? t("auth.signingIn") : t("auth.signIn")}
          </button>

          <p style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
            <Link href="/forgot-password" className="tt-accent">
              {t("auth.forgotPassword")}
            </Link>
          </p>

          {error && <p style={{ color: "#c0392b", fontSize: 13 }}>{error}</p>}

          <p className="tt-muted" style={{ fontSize: 13, marginTop: 20 }}>
            {t("auth.newHere")}{" "}
            <Link href="/signup" className="tt-accent">
              {t("auth.createAccountLink")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
