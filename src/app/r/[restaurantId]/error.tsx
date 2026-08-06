"use client";

import { useEffect } from "react";
import { useT } from "@/lib/i18n/context";

/**
 * Shown when loading the menu throws — a transient DB fault, most often.
 *
 * This exists because the alternative is worse than it looks: without it Next
 * renders a bare "Application error" to someone sitting at a table holding a
 * menu they can't read. Worse, the code used to swallow those faults entirely
 * and 404, which told the diner their QR code was invalid. A retry button is
 * the honest answer, because a retry usually works.
 */
export default function MenuError({
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
    console.error("Menu failed to load:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="tt-fallback">
      <div className="tt-fallback-emoji">🍽️</div>
      <h1 className="tt-serif">{t("fallback.errorTitle")}</h1>
      <p className="tt-muted">{t("fallback.errorBody")}</p>
      <button type="button" className="tt-btn tt-btn-primary" onClick={reset}>
        {t("fallback.retry")}
      </button>
    </div>
  );
}
