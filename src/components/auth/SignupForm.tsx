"use client";

import { useState } from "react";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";
import Link from "next/link";
import SignupVerification from "./SignupVerification";
import { useT } from "@/lib/i18n/context";
import { RESTAURANT_NAME_MAX } from "@/lib/restaurant-name";

/** Request the link the owner will use to set their password. */
export default function SignupForm() {
  const t = useT();
  const [restaurantName, setRestaurantName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantName, email, acceptedTerms }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? t("auth.couldNotCreate"));
        return;
      }
      setPending(true);
    } catch {
      setError(t("done.networkError"));
    } finally {
      setLoading(false);
    }
  }

  if (pending) return <SignupVerification initialEmail={email} />;

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
            maxLength={RESTAURANT_NAME_MAX}
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
          {/* Consent is given here, deliberately unticked, with both documents
              one tap away. A box that is already ticked is not consent, and a
              link nobody can reach before signing is not disclosure. */}
          <label className="tt-check tt-signup-terms">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={e => setAcceptedTerms(e.target.checked)}
            />
            <span>
              {t("auth.termsAccept")}{" "}
              <a href={TERMS_PATH} target="_blank" rel="noreferrer">
                {t("auth.termsLink")}
              </a>{" "}
              {t("auth.and")}{" "}
              <a href={PRIVACY_PATH} target="_blank" rel="noreferrer">
                {t("auth.privacyLink")}
              </a>
              .
            </span>
          </label>

          <button
            className="tt-btn tt-btn-primary"
            style={{ width: "100%" }}
            disabled={
              !restaurantName ||
              !email ||
              !acceptedTerms ||
              loading
            }
            type="submit"
          >
            {t(loading ? "auth.sending" : "auth.sendSignupLink")}
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
