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
 *
 * Only the owner is offered the plans: /dashboard/plan is theirs alone, and a
 * manager, cashier or waiter who pressed "Ver planes" was sent back to the
 * dashboard with no word why. They are told who can change it instead — the
 * way the frozen banner and the account menu already did.
 */
export default function PlanLock({
  feature,
  unlocksWith,
  isOwner,
}: {
  /** dineIn | promotions | coupons | staffDiscounts — a key under plan.needs. */
  feature: string;
  /** The cheapest tier that includes it. */
  unlocksWith: string;
  /** Whether the viewer can change the plan — only the owner can. */
  isOwner: boolean;
}) {
  const t = useT();

  return (
    <div className="tt-section tt-plan-lock">
      <div className="tt-plan-lock-body">
        <SecureIcon size={20} weight="bold" aria-hidden="true" />
        <div>
          <strong>{t(`plan.needs.${feature}`, { plan: planLabel(unlocksWith) })}</strong>
          <p className="tt-muted">{t(isOwner ? "plan.lockHint" : "plan.askOwner")}</p>
        </div>
      </div>
      {isOwner && (
        <Link href="/dashboard/plan" className="tt-btn tt-btn-primary tt-btn-sm">
          {t("plan.seePlans")}
        </Link>
      )}
    </div>
  );
}
