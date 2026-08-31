"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { isSelfServe } from "@/lib/billing";
import { launchSaving, planLabel, type PlanLimits, type PlanName } from "@/lib/plan";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { currentPrice, foundingOpen, slotsLeft } from "@/lib/founding";
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
  if (limits.allows_deferred_payment) lines.push(t("plan.tier.deferredPayment"));
  if (limits.allows_menu_schedules) lines.push(t("plan.tier.schedules"));
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
  foundingNumber,
  foundersTaken,
}: {
  catalog: PlanLimits[];
  current: PlanName;
  currency: string;
  foundingNumber: number | null;
  foundersTaken: number;
}) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<PlanName | null>(null);

  const isFounder = foundingNumber !== null;
  const left = slotsLeft(foundersTaken);
  const stillOpen = foundingOpen(foundersTaken);

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

      {/* Founder: the promise is that the price never rises, not that it is
          cheap today. Whoever already is one is told their number — it is the
          receipt. */}
      {isFounder ? (
        <p className="tt-founding tt-founding-locked">
          <strong>{t("plan.foundingYou", { n: foundingNumber })}</strong>{" "}
          {t("plan.foundingYouBody")}
        </p>
      ) : stillOpen ? (
        <p className="tt-founding">
          <strong>{t("plan.foundingLeft", { n: left })}</strong>{" "}
          {t("plan.foundingLeftBody")}
        </p>
      ) : null}

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
                {/* Nobody can buy this one yet, and one login still belongs to
                    exactly one restaurant. Saying so is better than letting an
                    owner ask for it and find out from us. */}
                {tier.plan === "grupo" && !isCurrent && (
                  <span className="tt-tier-badge tt-tier-soon">{t("plan.soon")}</span>
                )}
              </div>

              <div className="tt-tier-price">
                {/* "desde", because a multi-site price depends on how many
                    sites — quoting one number we cannot honour is worse than
                    admitting it is a conversation. */}
                {tier.plan === "grupo" && (
                  <span className="tt-tier-from">{t("plan.from")} </span>
                )}
                {tier.monthly_price === 0
                  ? t("plan.free")
                  : formatMoney(currentPrice(tier, foundersTaken), currency)}
                {tier.monthly_price > 0 && (
                  <span className="tt-tier-per">{t("plan.perMonth")}</span>
                )}
              </div>

              {/* What it will cost once the founding places run out, struck
                  through beside what is paid today. The strike-through says
                  something true: it is the price for whoever arrives next, not
                  a number invented to make the one above look cheap. */}
              {stillOpen && launchSaving(tier) > 0 && (
                <p className="tt-tier-launch">
                  <s>{formatMoney(tier.list_price ?? 0, currency)}</s>{" "}
                  <span className="tt-save">
                    {isFounder ? t("plan.foundingLocked") : t("plan.foundingPrice")}
                  </span>
                </p>
              )}

              {/* Every peso a restaurant pays, named. The card fee is not ours
                  and we do not collect it, but hiding it is what makes an owner
                  feel they were not told the whole thing. */}
              <ul className="tt-tier-costs">
                <li>
                  {tier.order_fee > 0
                    ? t("plan.orderFee", { fee: formatMoney(tier.order_fee, currency) })
                    : t("plan.noOrderFee")}
                </li>
                {tier.fee_cap ? (
                  <li className="tt-save">
                    {t("plan.feeCap", { cap: formatMoney(tier.fee_cap, currency) })}
                  </li>
                ) : null}
                <li className="tt-muted">{t("plan.stripeFee")}</li>
              </ul>

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
