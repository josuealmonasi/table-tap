"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { isSelfServe } from "@/lib/billing";
import { planLabel, type PlanLimits, type PlanName } from "@/lib/plan";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { CheckIcon } from "@/components/ui/icons";

/** The line under a tier's price: what it holds, in the order an owner asks. */
function includes(limits: PlanLimits, t: (k: string, v?: Record<string, string | number>) => string): string[] {
  // Zero is a different sentence, not a smaller number: a tick beside
  // "0 tables" reads as a joke. The free tier says what it IS instead.
  const cap = (n: number | null, key: string) =>
    n === null
      ? t(`plan.tier.${key}Unlimited`)
      : n === 0
        ? t(`plan.tier.${key}None`)
        : t(`plan.tier.${key}`, { n });

  const lines = [cap(limits.max_tables, "tables"), cap(limits.max_staff, "staff")];
  if (limits.allows_promotions) lines.push(t("plan.tier.promotions"));
  if (limits.allows_coupons) lines.push(t("plan.tier.coupons"));
  if (limits.allows_staff_discounts) lines.push(t("plan.tier.staffDiscounts"));
  return lines;
}

/**
 * The tiers, with the one they are on marked and the rest priced.
 *
 * Every card says what it holds rather than only what it costs — the question
 * an owner is actually asking is "does this fit my restaurant", and a column
 * of prices does not answer it.
 */
export default function PlanTiers({
  catalog,
  current,
  currency,
}: {
  catalog: PlanLimits[];
  current: PlanName;
  currency: string;
}) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<PlanName | null>(null);

  async function subscribe(plan: PlanName): Promise<void> {
    setBusy(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      // Stripe's own page takes it from here — the card never touches this app.
      if (data.url) window.location.href = data.url;
      else {
        toast(data.error ?? t("notice.generic"), "error");
        setBusy(null);
      }
    } catch {
      toast(t("notice.network"), "error");
      setBusy(null);
    }
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("plan.tiersTitle")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("plan.tiersHint")}
        </span>
      </div>

      <div className="tt-tier-grid">
        {catalog.map(tier => {
          const isCurrent = tier.plan === current;
          return (
            <div
              key={tier.plan}
              className={`tt-tier ${isCurrent ? "tt-tier-current" : ""}`}
              aria-current={isCurrent ? "true" : undefined}
            >
              <div className="tt-tier-head">
                <strong className="tt-serif tt-tier-name">{planLabel(tier.plan)}</strong>
                {isCurrent && <span className="tt-tier-badge">{t("plan.current")}</span>}
              </div>

              <div className="tt-tier-price">
                {tier.monthly_price === 0
                  ? t("plan.free")
                  : formatMoney(tier.monthly_price, currency)}
                {tier.monthly_price > 0 && (
                  <span className="tt-tier-per">{t("plan.perMonth")}</span>
                )}
              </div>
              <p className="tt-muted tt-tier-fee">
                {tier.order_fee > 0
                  ? t("plan.orderFee", { fee: formatMoney(tier.order_fee, currency) })
                  : t("plan.noOrderFee")}
              </p>

              <ul className="tt-tier-list">
                {includes(tier, t).map(line => (
                  <li key={line}>
                    <CheckIcon size={14} weight="bold" aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <button className="tt-btn tt-btn-ghost" disabled>
                  {t("plan.current")}
                </button>
              ) : isSelfServe(tier.plan) ? (
                <button
                  className="tt-btn tt-btn-primary"
                  disabled={busy !== null}
                  onClick={() => subscribe(tier.plan)}
                >
                  {busy === tier.plan ? t("plan.opening") : t("plan.choose")}
                </button>
              ) : (
                // Carta is what a lapsed subscription lands on rather than
                // something to buy; Grupo is a conversation before it is a
                // card. Neither has a button that would do anything honest.
                <p className="tt-muted tt-tier-note">
                  {tier.plan === "carta" ? t("plan.freeNote") : t("plan.contactNote")}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
