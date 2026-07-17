"use client";

import { useEffect, useState } from "react";

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
      setError(data.error ?? "Couldn't start Stripe onboarding.");
    } catch {
      setError("Network error — please try again.");
    }
    setRedirecting(false);
  }

  return (
    <div className="tt-section" style={{ maxWidth: 520, marginTop: 16 }}>
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          Payments
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          Where your customers&apos; money goes
        </span>
      </div>

      {loading ? (
        <p className="tt-muted" style={{ fontSize: 14, margin: 0 }}>
          Checking your payment setup…
        </p>
      ) : status?.chargesEnabled ? (
        <p style={{ fontSize: 14, margin: 0 }}>
          <span className="tt-badge tt-badge-green">✓ Connected</span>{" "}
          Payments for your orders go straight to your Stripe account.
        </p>
      ) : (
        <>
          <p className="tt-muted" style={{ fontSize: 14, marginTop: 0 }}>
            {status?.connected
              ? "Your Stripe setup is almost done — finish it so you can start taking orders."
              : "Connect a Stripe account so customer payments land in your bank. Until then, customers can’t check out."}
          </p>
          <button
            className="tt-btn tt-btn-primary tt-btn-sm"
            onClick={connect}
            disabled={redirecting}
          >
            {redirecting
              ? "Redirecting…"
              : status?.connected
                ? "Finish Stripe setup"
                : "Connect Stripe"}
          </button>
          {error && (
            <p style={{ color: "#c0392b", fontSize: 13, marginBottom: 0 }}>{error}</p>
          )}
        </>
      )}
    </div>
  );
}
