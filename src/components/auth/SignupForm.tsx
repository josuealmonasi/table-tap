"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";

/** Create a restaurant account: provisions the user + their restaurant, then signs in. */
export default function SignupForm() {
  const t = useT();
  const [restaurantName, setRestaurantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Server creates the auth user (pre-confirmed) + the restaurant row.
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantName, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? t("auth.couldNotCreate"));
      setLoading(false);
      return;
    }

    // Sign in with the credentials we just created.
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setError(t("auth.accountCreatedSignIn"));
      setLoading(false);
      return;
    }
    window.location.assign("/dashboard");
  }

  return (
    <div className="tt-login">
      <div className="container">
        <form className="tt-login-card" onSubmit={handleSubmit}>
          <div style={{ fontSize: 32 }}>🌸</div>
          <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>
            {t("auth.createTitle")}
          </h1>
          <p className="tt-muted" style={{ marginTop: 0 }}>
            {t("auth.createSub")}
          </p>

          <input
            className="tt-input"
            type="text"
            placeholder={t("auth.restaurantNamePlaceholder")}
            value={restaurantName}
            onChange={e => setRestaurantName(e.target.value)}
            style={{ marginBottom: 12 }}
            required
          />
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
            placeholder={t("auth.passwordMinPlaceholder")}
            autoComplete="new-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ marginBottom: 12 }}
            minLength={6}
            required
          />
          <button
            className="tt-btn tt-btn-primary"
            style={{ width: "100%" }}
            disabled={!restaurantName || !email || password.length < 6 || loading}
            type="submit"
          >
            {loading ? t("auth.creatingAccount") : t("auth.createAccount")}
          </button>

          {error && <p className="tt-field-error">{error}</p>}

          <p className="tt-muted" style={{ fontSize: 13, marginTop: 20 }}>
            {t("auth.haveAccount")}{" "}
            <Link href="/login" className="tt-accent">
              {t("auth.signIn")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
