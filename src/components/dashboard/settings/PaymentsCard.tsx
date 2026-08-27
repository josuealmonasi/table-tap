"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { CheckIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";

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
    // `id` so the switches' warning can point here: whoever reads "you cannot
    // take card payments" needs to reach the button that fixes it.
    <div className="tt-section" id="pagos">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("dash.payments")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("dash.paymentsHint")}
        </span>
      </div>

      {loading ? (
        // One line, not list rows: this reports a connection status, so the
        // placeholder should be the shape of the sentence that replaces it.
        <Skeleton width="72%" height={14} />
      ) : status?.chargesEnabled ? (
        <p style={{ fontSize: 14, margin: 0 }}>
          <span className="tt-badge tt-badge-green">
            <CheckIcon size={12} weight="bold" /> {t("dash.connected")}
          </span>{" "}
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
          {error && <p className="tt-field-error">{error}</p>}
        </>
      )}
    </div>
  );
}
