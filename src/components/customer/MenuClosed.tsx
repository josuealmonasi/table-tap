"use client";

import { ScheduleIcon } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/context";

/**
 * Shown in place of the menu when no menu is serving at this hour.
 *
 * An empty dish list reads as a broken page, and the diner has no way to tell
 * a closed kitchen from a failed load — the two looked identical. This says
 * which it is.
 */
export default function MenuClosed() {
  const t = useT();
  return (
    <div className="tt-closed-now" role="status">
      <ScheduleIcon size={40} className="tt-empty-icon" />
      <strong>{t("menu.closedNowTitle")}</strong>
      <p className="tt-muted">{t("menu.closedNowBody")}</p>
    </div>
  );
}
