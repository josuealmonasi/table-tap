"use client";

import Link from "next/link";
import { planLabel } from "@/lib/plan";
import type { TrialNotice } from "@/lib/trial-notice";
import { assignedPayPath } from "@/lib/assigned-pay-path";
import { dateLocale } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/context";

/**
 * The owner's free trial, on every dashboard screen: how long is left and what
 * happens after. Until this, only a line on the Plan page said a trial was
 * running at all, so the fall back to Carta came as a surprise.
 */
export default function TrialBanner({ notice }: { notice: TrialNotice }) {
  const t = useT();
  const { locale } = useLocale();
  if (notice.assignment) {
    const date = new Date(notice.endsAt).toLocaleDateString(dateLocale(locale), { day: "numeric", month: "long", timeZone: "America/Mexico_City" });
    return (
      <div className={`tt-frozen-banner tt-trial-banner${notice.urgent ? " tt-frozen-banner-warn" : ""}`} role="status">
        <span className="tt-frozen-text">{t("trial.assignedBanner", { plan: planLabel(notice.plan), date })}</span>
        {/* A plain link: the pay route answers with a redirect to Stripe Checkout. */}
        <a href={assignedPayPath(notice.plan, notice.assignment)} className="tt-btn tt-btn-sm tt-btn-primary">{t("trial.payNow")}</a>
      </div>
    );
  }
  return (
    <div className={`tt-frozen-banner tt-trial-banner${notice.urgent ? " tt-frozen-banner-warn" : ""}`} role="status">
      <span className="tt-frozen-text">
        {t(notice.urgent ? "trial.bannerUrgent" : "trial.banner", { plan: planLabel(notice.plan), days: notice.days })}
      </span>
      <Link href="/dashboard/plan" className="tt-btn tt-btn-sm tt-btn-primary">{t("trial.seePlans")}</Link>
    </div>
  );
}
