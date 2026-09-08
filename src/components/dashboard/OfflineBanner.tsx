"use client";

import { useT } from "@/lib/i18n/context";

/**
 * Says the board is reading history, and what is waiting to be sent.
 *
 * The same reasoning as the frozen-plan banner: a screen must not offer what
 * the system will refuse. Offline that is most of the dashboard, and the honest
 * thing is to say it once at the top rather than let somebody tap Cobrar and
 * find out from a failure.
 *
 * The count matters as much as the state. A cook who moved four tickets during
 * a drop needs to know the four are held, not lost — otherwise the reasonable
 * thing to do is move them all again, and the board they come back to will be
 * arguing with itself.
 */
export default function OfflineBanner({ pending }: { pending: number }) {
  const t = useT();
  return (
    <div className="tt-offline-banner" role="status" aria-live="polite">
      <span>{t("offline.banner")}</span>
      {pending > 0 && <strong>{t("offline.queued", { n: pending })}</strong>}
    </div>
  );
}
