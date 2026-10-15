"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { change, perShownUnit } from "@/lib/costs/display";
import type { PriceRise } from "@/lib/costs/price-rises";
import { WarningIcon } from "@/components/ui/icons";

interface PriceRisesProps {
  rises: PriceRise[];
  currency: string;
}

/** Each supplier rise in the last 30 days, with what it took off each product. */
export default function PriceRises({ rises, currency }: PriceRisesProps) {
  const t = useT();
  const money = (n: number) => formatMoney(n, currency);
  return (
    <section className="tt-section tt-costs-rises">
      <h2 className="tt-costs-heading">
        <WarningIcon size={18} weight="bold" aria-hidden="true" /> {t("costs.risesTitle")}
      </h2>
      <ul className="tt-costs-rise-list">
        {rises.map(r => {
          const before = perShownUnit(r.before, r.unit);
          const after = perShownUnit(r.after, r.unit);
          return (
            <li key={r.ingredientId}>
              <strong>
                {t("costs.riseLine", {
                  name: r.name,
                  before: money(before.amount),
                  after: money(after.amount),
                  unit: t(`costs.unitShort.${after.unit}`),
                  pct: change(r.before, r.after),
                })}
              </strong>
              {r.products.length ? (
                <span className="tt-muted">
                  {r.products
                    .map(p => t("costs.riseProduct", { name: p.name, amount: money(p.marginBefore - p.marginAfter) }))
                    .join(" · ")}
                </span>
              ) : (
                <span className="tt-muted">{t("costs.riseNoProduct")}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
