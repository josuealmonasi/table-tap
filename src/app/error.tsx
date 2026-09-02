"use client";

import { useEffect } from "react";
import { useT } from "@/lib/i18n/context";

/**
 * The last screen between an unhandled error and a bare browser page.
 *
 * The diner menu has had one of these for a while, and the reasoning there
 * applies everywhere else too: without it Next renders "Application error: a
 * client-side exception has occurred" — no shell, no Spanish, no way back —
 * and until now that was what a waiter got if the orders board threw mid
 * service. Every route outside /r had nothing.
 *
 * It says no order was lost, because that is the first thing anyone standing
 * at a till wants to know, and it offers a retry, because a transient database
 * fault is what usually brings someone here.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    // The digest is what ties this screen to the stack trace in the platform
    // logs; the message itself is stripped from the client bundle in prod.
    console.error("Unhandled error:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="tt-fallback">
      <div className="tt-fallback-emoji">🛠️</div>
      <h1 className="tt-serif">{t("fallback.appErrorTitle")}</h1>
      <p className="tt-muted">{t("fallback.appErrorBody")}</p>
      <button type="button" className="tt-btn tt-btn-primary" onClick={reset}>
        {t("fallback.retry")}
      </button>
    </div>
  );
}
