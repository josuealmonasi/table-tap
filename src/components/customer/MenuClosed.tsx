"use client";

import { ScheduleIcon } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/context";

/**
 * Shown in place of the menu when there is nothing a diner can order.
 *
 * An empty dish list reads as a broken page, and the diner has no way to tell
 * a closed kitchen from a failed load — the two looked identical. This says
 * which it is.
 *
 * Two different reasons, because they ask the diner to do different things.
 * A kitchen that is closed will open later, so "come back during opening
 * hours" is useful. A restaurant that has not built its menu yet will not,
 * and telling that diner to come back later would be a guess dressed as a
 * fact — they should ask the staff. Before this the second case rendered
 * nothing at all: a header, a lone "Todo" tab and a white page.
 */
export default function MenuClosed({ reason = "closed" }: { reason?: "closed" | "empty" }) {
  const t = useT();
  const closed = reason === "closed";
  return (
    <div className="tt-closed-now" role="status">
      <ScheduleIcon size={40} className="tt-empty-icon" />
      <strong>{t(closed ? "menu.closedNowTitle" : "menu.notReadyTitle")}</strong>
      <p className="tt-muted">{t(closed ? "menu.closedNowBody" : "menu.notReadyBody")}</p>
    </div>
  );
}
