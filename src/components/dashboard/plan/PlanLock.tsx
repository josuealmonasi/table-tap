"use client";

import Link from "next/link";
import { planLabel } from "@/lib/plan";
import { useT } from "@/lib/i18n/context";
import { SecureIcon } from "@/components/ui/icons";

/**
 * A feature the current tier doesn't include, shown where the feature would be.
 *
 * Named rather than merely locked: "coupons come with Casa" tells an owner
 * what to do next, where a padlock and the word "upgrade" only tells them they
 * can't. It sits in the layout the real panel would occupy so the page doesn't
 * change shape when a plan changes.
 */
export default function PlanLock({
  feature,
  unlocksWith,
}: {
  /** dineIn | promotions | coupons | staffDiscounts — a key under plan.needs. */
  feature: string;
  /** The cheapest tier that includes it. */
  unlocksWith: string;
}) {
  const t = useT();

  return (
    <div className="tt-section tt-plan-lock">
      <div className="tt-plan-lock-body">
        <SecureIcon size={20} weight="bold" aria-hidden="true" />
        <div>
          <strong>{t(`plan.needs.${feature}`, { plan: planLabel(unlocksWith) })}</strong>
          <p className="tt-muted">{t("plan.lockHint")}</p>
        </div>
      </div>
      <Link href="/dashboard/plan" className="tt-btn tt-btn-primary tt-btn-sm">
        {t("plan.seePlans")}
      </Link>
    </div>
  );
}
