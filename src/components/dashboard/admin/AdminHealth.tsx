"use client";

import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";
import { schedulerStale, webhookBad, type PlatformHealth } from "@/lib/admin-health-rules";

interface AdminHealthProps {
  /** Null when the counts could not be read: the panel still works, this says so. */
  health: PlatformHealth | null;
}

/** The platform's silent failures, counted: red when something needs a look. */
export default function AdminHealth({ health }: AdminHealthProps) {
  const t = useT();
  const { locale } = useLocale();
  const head = (
    <div className="tt-section-head">
      <h3 className="tt-serif" style={{ margin: 0 }}>{t("adminHealth.title")}</h3>
    </div>
  );
  if (!health) return <div className="tt-section">{head}<p className="tt-muted" role="status">{t("adminHealth.unavailable")}</p></div>;
  const stale = schedulerStale(health.schedulerLastRun);
  const when = (iso: string | null) => iso
    ? new Date(iso).toLocaleString(dateLocale(locale), { timeZone: "America/Mexico_City" })
    : t("adminHealth.never");
  const items: { label: string; value: string; bad: boolean; note?: string }[] = [
    { label: t("adminHealth.scheduler"), bad: stale, value: when(health.schedulerLastRun) },
    { label: t("adminHealth.tickets"), value: String(health.failedTickets7d), bad: health.failedTickets7d > 0 },
    { label: t("adminHealth.notices"), value: String(health.stuckPriceNotices), bad: health.stuckPriceNotices > 0 },
    { label: t("adminHealth.noCards"), value: String(health.noCards), bad: false },
    ...health.webhooks.map(w => ({
      label: t(`adminHealth.webhook.${w.stream}`), bad: webhookBad(w), value: when(w.lastOkAt),
      note: w.lastRefusal && w.lastRefusedAt
        ? t("adminHealth.webhookRefused", { when: when(w.lastRefusedAt), why: t(`adminHealth.refusal.${w.lastRefusal}`) })
        : undefined,
    })),
  ];
  return (
    <div className="tt-section">
      {head}
      <ul className="tt-admin-health">
        {items.map(i => (
          <li key={i.label} className={i.bad ? "tt-admin-health--bad" : undefined}>
            <span className="tt-muted">{i.label}</span>
            <strong>{i.value}</strong>
            {i.note ? <span className="tt-muted">{i.note}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
