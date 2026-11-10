"use client";

import { useState } from "react";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";
import Link from "next/link";
import SignupVerification from "./SignupVerification";
import { PASSWORD_MIN } from "@/lib/password";
import { useT } from "@/lib/i18n/context";

/** Create a pending restaurant account, then ask the owner to verify their email. */
export default function SignupForm() {
  const t = useT();
  const [restaurantName, setRestaurantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ sent: boolean } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Server creates the unconfirmed auth user + the pending restaurant row.
    //
    // Wrapped because it was not: a dropped connection here threw past every
    // `setLoading(false)` below, so the button stayed spinning for good and the
    // form never said a word about why.
    let data: { error?: string; verificationSent?: boolean };
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantName, email, password, acceptedTerms }),
      });
      data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("auth.couldNotCreate"));
        setLoading(false);
        return;
      }
    } catch {
      setError(t("done.networkError"));
      setLoading(false);
      return;
    }

    // Verification, rather than knowing the chosen password, opens the restaurant.
    setPassword("");
    setPending({ sent: data.verificationSent !== false });
    setLoading(false);
  }

  if (pending) return <SignupVerification initialEmail={email} initialSent={pending.sent} />;

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
            minLength={PASSWORD_MIN}
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
              password.length < PASSWORD_MIN ||
              !acceptedTerms ||
              loading
            }
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
