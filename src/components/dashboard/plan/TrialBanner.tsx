"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import { planLabel } from "@/lib/plan";
import type { TrialNotice } from "@/lib/trial-notice";

/**
 * The owner's free trial, on every dashboard screen: how long is left and what
 * happens after. Until this, only a line on the Plan page said a trial was
 * running at all, so the fall back to Carta came as a surprise.
 */
export default function TrialBanner({ notice }: { notice: TrialNotice }) {
  const t = useT();
  return (
    <div className={`tt-frozen-banner tt-trial-banner${notice.urgent ? " tt-frozen-banner-warn" : ""}`} role="status">
      <span className="tt-frozen-text">
        {t(notice.urgent ? "trial.bannerUrgent" : "trial.banner", { plan: planLabel(notice.plan), days: notice.days })}
      </span>
      <Link href="/dashboard/plan" className="tt-btn tt-btn-sm tt-btn-primary">{t("trial.seePlans")}</Link>
    </div>
  );
}
