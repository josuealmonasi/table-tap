"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { planLabel, trialDaysLeft, type PlanLimits, type PlanStatus } from "@/lib/plan";
import type { RestaurantPlan } from "@/lib/plan-server";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import Breadcrumb from "@/components/layout/Breadcrumb";
import PlanUsage, { type PlanUsageCounts } from "./PlanUsage";
import PlanTiers from "./PlanTiers";

/** The tone of the status line: neutral while healthy, loud when money stopped. */
const TONE: Record<PlanStatus, string> = {
  trialing: "tt-plan-state",
  active: "tt-plan-state",
  past_due: "tt-plan-state tt-plan-state-warn",
  locked: "tt-plan-state tt-plan-state-warn",
};

export default function PlanPanel({
  plan,
  catalog,
  usage,
  hasBilling,
  currency,
}: {
  plan: RestaurantPlan;
  catalog: PlanLimits[];
  usage: PlanUsageCounts;
  /** There is a Stripe customer, so there is something to manage. */
  hasBilling: boolean;
  currency: string;
}) {
  const t = useT();
  const toast = useToast();
  const [opening, setOpening] = useState(false);
  const days = trialDaysLeft(plan.trialEndsAt);

  async function openPortal(): Promise<void> {
    setOpening(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else {
        toast(data.error ?? t("notice.generic"), "error");
        setOpening(false);
      }
    } catch {
      toast(t("notice.network"), "error");
      setOpening(false);
    }
  }

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.plan" }]}
          />
        </header>

        <div className="tt-section">
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              {t("plan.currentTitle")}
            </h3>
          </div>

          {/* Name and price share a line, and the status gets the width under
              them. Nesting the status with the name made the price wrap below
              on a phone the moment the message was more than a word — which
              is exactly when it matters, since the long ones are the ones
              about money having stopped. */}
          <div className="tt-plan-now">
            <strong className="tt-serif tt-plan-name">{planLabel(plan.limits.plan)}</strong>
            <div className="tt-plan-cost">
              <strong>
                {plan.limits.monthly_price === 0
                  ? t("plan.free")
                  : formatMoney(plan.limits.monthly_price, currency)}
              </strong>
              {plan.limits.monthly_price > 0 && <span>{t("plan.perMonth")}</span>}
            </div>
          </div>
          <p className={TONE[plan.status]}>
            {plan.status === "trialing"
              ? t("plan.state.trialing", { days })
              : t(`plan.state.${plan.status}`)}
          </p>

          {/* Cards, receipts and cancelling all live on Stripe's own page:
              it is where the card details already are, and each of those
              screens is a place to get card handling wrong. */}
          {hasBilling && (
            <button
              className="tt-btn tt-btn-ghost tt-plan-manage"
              disabled={opening}
              onClick={openPortal}
            >
              {opening ? t("plan.opening") : t("plan.manage")}
            </button>
          )}
        </div>

        <PlanUsage limits={plan.limits} usage={usage} />
        <PlanTiers catalog={catalog} current={plan.limits.plan} currency={currency} />
      </div>
    </div>
  );
}
