"use client";

import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";
import { schedulerStale, type PlatformHealth } from "@/lib/admin-health-rules";

interface AdminHealthProps {
  health: PlatformHealth;
}

/** The platform's silent failures, counted: red when something needs a look. */
export default function AdminHealth({ health }: AdminHealthProps) {
  const t = useT();
  const { locale } = useLocale();
  const stale = schedulerStale(health.schedulerLastRun);
  const items: { label: string; value: string; bad: boolean }[] = [
    { label: t("adminHealth.scheduler"), bad: stale,
      value: health.schedulerLastRun
        ? new Date(health.schedulerLastRun).toLocaleString(dateLocale(locale), { timeZone: "America/Mexico_City" })
        : t("adminHealth.never") },
    { label: t("adminHealth.tickets"), value: String(health.failedTickets7d), bad: health.failedTickets7d > 0 },
    { label: t("adminHealth.notices"), value: String(health.stuckPriceNotices), bad: health.stuckPriceNotices > 0 },
    { label: t("adminHealth.noCards"), value: String(health.noCards), bad: false },
  ];
  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>{t("adminHealth.title")}</h3>
      </div>
      <ul className="tt-admin-health">
        {items.map(i => (
          <li key={i.label} className={i.bad ? "tt-admin-health--bad" : undefined}>
            <span className="tt-muted">{i.label}</span>
            <strong>{i.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
