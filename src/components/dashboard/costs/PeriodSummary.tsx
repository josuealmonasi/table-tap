"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { percent } from "@/lib/costs/display";
import type { PeriodContribution } from "@/lib/costs/margins";

interface PeriodSummaryProps {
  period: PeriodContribution;
  currency: string;
}

/**
 * The last 30 days in four figures: what was sold without IVA, what went
 * into it, what taking the money cost, and what was left. Sales of products
 * whose old ingredient cost is unknown are named, because it is missing from the figures.
 */
export default function PeriodSummary({ period, currency }: PeriodSummaryProps) {
  const t = useT();
  const money = (n: number) => formatMoney(n, currency);
  const share = period.revenue > 0 ? percent(period.contribution / period.revenue) : "—";
  return (
    <section className="tt-costs-period" aria-label={t("costs.periodTitle")}>
      <h2 className="tt-costs-heading">{t("costs.periodTitle")}</h2>
      <div className="tt-analytics-tiles">
        <div className="tt-analytics-tile">
          <strong>{money(period.revenue)}</strong>
          <span>{t("costs.revenue")}</span>
        </div>
        <div className="tt-analytics-tile">
          <strong>{money(period.cost)}</strong>
          <span>{t("costs.ingredientsCost")}</span>
        </div>
        <div className="tt-analytics-tile">
          <strong>{money(period.fees)}</strong>
          <span>{t("costs.feesCost")}</span>
        </div>
        <div className="tt-analytics-tile">
          <strong className={period.contribution < 0 ? "tt-costs-loss" : "tt-costs-gain"}>{money(period.contribution)}</strong>
          <span>{t("costs.leftPct", { pct: share })}</span>
        </div>
      </div>
      {period.rows.some(row => !row.complete) && (
        <p className="tt-costs-warning" role="note">{t("costs.uncosted", { amount: money(period.uncosted) })}</p>
      )}
    </section>
  );
}
