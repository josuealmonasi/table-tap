"use client";

import { useT } from "@/lib/i18n/context";

/**
 * The restaurant genuinely doesn't exist. Permanent, so there's no retry —
 * retrying a dead id just fails again. Points at staff instead, who are the
 * only ones who can actually fix a bad QR code on a table.
 */
export default function MenuNotFound() {
  const t = useT();

  return (
    <div className="tt-fallback">
      <div className="tt-fallback-emoji">🔍</div>
      <h1 className="tt-serif">{t("fallback.notFoundTitle")}</h1>
      <p className="tt-muted">{t("fallback.notFoundBody")}</p>
    </div>
  );
}
