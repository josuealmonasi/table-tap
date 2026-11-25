"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

interface DigestLinkActionProps {
  kind: "confirm" | "stop";
  token: string | null;
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Mail scanners open links too. Only the holder's button confirms or stops. */
export default function DigestLinkAction({ kind, token }: DigestLinkActionProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [restaurant, setRestaurant] = useState<string | null>(null);
  const [missing, setMissing] = useState(!token || !TOKEN.test(token));
  const [error, setError] = useState(false);

  async function act(): Promise<void> {
    if (busy || missing || restaurant !== null) return;
    setBusy(true); setError(false);
    try {
      const res = await fetch(`/api/digest/${kind}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404) { setMissing(true); return; }
      if (!res.ok) throw new Error("Digest link failed");
      const data = await res.json();
      setRestaurant(typeof data.restaurant === "string" ? data.restaurant : "");
    } catch { setError(true); }
    finally { setBusy(false); }
  }

  return <div className="tt-login"><div className="container"><section className="tt-login-card">
    <h1 className="tt-serif">{t(`digestRecipients.${kind}Title`)}</h1>
    {restaurant !== null ? <p role="status">{t(`digestRecipients.${kind}Done`, { restaurant })}</p>
      : missing ? <p role="status">{t(`digestRecipients.${kind}Missing`)}</p>
      : <button type="button" className="tt-btn tt-btn-primary" disabled={busy} onClick={() => void act()}>{t(`digestRecipients.${kind}Action`)}</button>}
    {error && <p role="alert" className="tt-field-error">{t("digestRecipients.linkFailed")}</p>}
  </section></div></div>;
}
