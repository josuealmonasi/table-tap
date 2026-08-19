"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/format";
import { planLabel, trialDaysLeft, type PlanLimits, type PlanStatus } from "@/lib/plan";
import type { RestaurantPlan } from "@/lib/plan-server";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Breadcrumb from "@/components/layout/Breadcrumb";
import PlanUsage, { type PlanUsageCounts } from "./PlanUsage";
import PlanTiers from "./PlanTiers";
import PlanDocuments from "./PlanDocuments";

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
  acceptedVersion,
  acceptedAt,
  currency,
  foundingNumber,
  foundersTaken,
}: {
  plan: RestaurantPlan;
  catalog: PlanLimits[];
  usage: PlanUsageCounts;
  /** There is a Stripe customer, so there is something to manage. */
  hasBilling: boolean;
  /** Which terms this restaurant accepted, and when. */
  acceptedVersion: string | null;
  acceptedAt: string | null;
  currency: string;
  /** Su número de fundador, si lo es. */
  foundingNumber: number | null;
  /** Cuántos lugares se han tomado ya, para decir cuántos quedan. */
  foundersTaken: number;
}) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [opening, setOpening] = useState(false);
  const [ending, setEnding] = useState(false);
  const router = useRouter();
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

  /**
   * Ending the subscription, or changing your mind about it.
   *
   * Asked for plainly, and it says what actually happens: the plan runs to the
   * end of what has already been paid for, and nothing is deleted.
   */
  async function endPlan(resume: boolean): Promise<void> {
    if (
      !resume &&
      !(await confirm({
        title: t("plan.cancelConfirm"),
        message: t("plan.cancelBody"),
        confirmLabel: t("plan.cancelYes"),
        danger: true,
      }))
    ) {
      return;
    }
    setEnding(true);
    try {
      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume }),
      });
      const data = await res.json();
      if (!res.ok) toast(data.error ?? t("notice.generic"), "error");
      else {
        toast(t(resume ? "plan.resumed" : "plan.cancelled"));
        router.refresh();
      }
    } catch {
      toast(t("notice.network"), "error");
    } finally {
      setEnding(false);
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
          {/* Cancelling is never hidden. A plan that is hard to leave is a
              plan people are afraid to start, and the promise is worth more
              on the screen than in the terms. */}
          <p className="tt-plan-anytime">{t("plan.cancelAnytime")}</p>

          {plan.planEndsAt && (
            <p className="tt-plan-state tt-plan-state-warn">
              {t("plan.endsOn", {
                date: new Date(plan.planEndsAt).toLocaleDateString([], {
                  day: "numeric",
                  month: "long",
                }),
              })}
            </p>
          )}

          {hasBilling && (
            <div className="tt-plan-actions">
              <button
                className="tt-btn tt-btn-ghost tt-btn-sm"
                disabled={opening}
                onClick={openPortal}
              >
                {opening ? t("plan.opening") : t("plan.manage")}
              </button>
              {plan.planEndsAt ? (
                <button
                  className="tt-btn tt-btn-primary tt-btn-sm"
                  disabled={ending}
                  onClick={() => endPlan(true)}
                >
                  {t("plan.resume")}
                </button>
              ) : (
                <button
                  className="tt-btn tt-btn-ghost tt-btn-sm tt-plan-cancel"
                  disabled={ending}
                  onClick={() => endPlan(false)}
                >
                  {t("plan.cancel")}
                </button>
              )}
            </div>
          )}
        </div>

        <PlanUsage limits={plan.limits} usage={usage} />
        <PlanTiers
          catalog={catalog}
          current={plan.limits.plan}
          currency={currency}
          foundingNumber={foundingNumber}
          foundersTaken={foundersTaken}
        />
        <PlanDocuments acceptedVersion={acceptedVersion} acceptedAt={acceptedAt} />
      </div>
    </div>
  );
}
