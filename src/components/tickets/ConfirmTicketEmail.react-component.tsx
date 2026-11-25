"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { messagesFor, translate, type Locale } from "@/lib/i18n";

interface ConfirmTicketEmailProps {
  token: string | null;
  locale?: Locale;
}

export default function ConfirmTicketEmail({ token, locale }: ConfirmTicketEmailProps) {
  const translateFromDevice = useT();
  const t = (key: string) => locale ? translate(messagesFor(locale), key) : translateFromDevice(key);
  const [state, setState] = useState<"ready" | "busy" | "confirmed" | "missing" | "failed">(token ? "ready" : "missing");

  async function confirm(): Promise<void> {
    setState("busy");
    try {
      const response = await fetch("/api/tickets/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }), signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) setState("confirmed");
      else setState(response.status === 404 ? "missing" : "failed");
    } catch {
      setState("failed");
    }
  }

  return <div className="tt-login" lang={locale}><div className="container"><section className="tt-login-card">
    <h1 className="tt-serif">{t("cardEmail.confirmTitle")}</h1>
    {state === "confirmed" ? <p role="status">{t("cardEmail.confirmDone")}</p>
      : state === "missing" ? <p role="status">{t("cardEmail.confirmMissing")}</p>
      : <button type="button" className="tt-btn tt-btn-primary" disabled={state === "busy"} onClick={confirm}>
        {t("cardEmail.confirmAction")}
      </button>}
    {state === "failed" && <p role="alert" className="tt-field-error">{t("cardEmail.confirmFailed")}</p>}
  </section></div></div>;
}
