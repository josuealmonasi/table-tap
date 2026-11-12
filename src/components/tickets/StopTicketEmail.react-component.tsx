"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

interface StopTicketEmailProps { token: string | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mail scanners open links too. Only the diner's button changes their card. */
export default function StopTicketEmail({ token }: StopTicketEmailProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [restaurant, setRestaurant] = useState<string | null>(null);
  const [missing, setMissing] = useState(!token || !UUID.test(token));
  const [error, setError] = useState(false);

  async function stop(): Promise<void> {
    if (busy || missing || restaurant !== null) return;
    setBusy(true); setError(false);
    try {
      const res = await fetch("/api/tickets/stop", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404) { setMissing(true); return; }
      if (!res.ok) throw new Error("Could not stop ticket emails");
      const data = await res.json();
      if (typeof data.restaurant !== "string") throw new Error("Missing restaurant name");
      setRestaurant(data.restaurant);
    } catch { setError(true); }
    finally { setBusy(false); }
  }

  return <div className="tt-login"><div className="container"><section className="tt-login-card">
    <h1 className="tt-serif">{t("cardEmail.stopTitle")}</h1>
    {restaurant !== null ? <p role="status">{t("cardEmail.stopped", { restaurant })}</p>
      : missing ? <p role="status">{t("cardEmail.stopMissing")}</p>
      : <button type="button" className="tt-btn tt-btn-primary" disabled={busy} onClick={() => void stop()}>{t("cardEmail.stopAction")}</button>}
    {error && <p role="alert" className="tt-field-error">{t("cardEmail.stopFailed")}</p>}
  </section></div></div>;
}
