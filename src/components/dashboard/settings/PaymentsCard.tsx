"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

interface ConnectStatus {
  connected: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}

/**
 * Owner-only Payments card: connect (or finish connecting) the restaurant's own
 * Stripe account so customer payments land in their balance. Reads live status
 * from /api/connect/status and kicks off Stripe onboarding via /api/connect/onboard.
 */
export default function PaymentsCard() {
  const t = useT();
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/connect/status");
        const data = await res.json();
        if (!cancelled) setStatus(res.ok ? data : null);
      } catch {
        // Leave status null — the card falls back to the connect prompt.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function connect(): Promise<void> {
    setRedirecting(true);
    setError("");
    try {
      const res = await fetch("/api/connect/onboard", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url; // Stripe-hosted onboarding
        return;
      }
      setError(data.error ?? t("dash.connectError"));
    } catch {
      setError(t("notice.network"));
    }
    setRedirecting(false);
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("dash.payments")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("dash.paymentsHint")}
        </span>
      </div>

      {loading ? (
        <p className="tt-muted" style={{ fontSize: 14, margin: 0 }}>
          {t("dash.paymentsChecking")}
        </p>
      ) : status?.chargesEnabled ? (
        <p style={{ fontSize: 14, margin: 0 }}>
          <span className="tt-badge tt-badge-green">{t("dash.connected")}</span>{" "}
          {t("dash.connectedMsg")}
        </p>
      ) : (
        <>
          <p className="tt-muted" style={{ fontSize: 14, marginTop: 0 }}>
            {status?.connected ? t("dash.connectAlmost") : t("dash.connectPrompt")}
          </p>
          <button
            className="tt-btn tt-btn-primary tt-btn-sm"
            onClick={connect}
            disabled={redirecting}
          >
            {redirecting
              ? t("dash.redirecting")
              : status?.connected
                ? t("dash.finishBtn")
                : t("dash.connectBtn")}
          </button>
          {error && (
            <p style={{ color: "#c0392b", fontSize: 13, marginBottom: 0 }}>{error}</p>
          )}
        </>
      )}
    </div>
  );
}
