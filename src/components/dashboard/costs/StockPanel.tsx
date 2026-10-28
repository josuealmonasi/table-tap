"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { amount, inShown } from "@/lib/costs/display";
import type { StockView } from "@/lib/costs/stock-server";
import { useWhen } from "@/hooks/useWhen";
import CountDialog from "./CountDialog";
import { matchesIngredient, stockCountOrder } from "./stock-search";

interface StockPanelProps {
  stock: StockView;
  currency: string;
  timeZone?: string;
}

/**
 * What the shelf should hold, ingredient by ingredient, and how its last
 * count came out. The count itself is blind: it opens with nothing but the
 * names, and what was expected appears only once it is saved.
 */
export default function StockPanel({ stock, currency, timeZone }: StockPanelProps) {
  const t = useT();
  const when = useWhen(timeZone);
  const [counting, setCounting] = useState(false);
  const [search, setSearch] = useState("");
  const ingredients = stockCountOrder(stock.ingredients, stock.onHand);
  const visible = ingredients.filter(i => matchesIngredient(i, search));
  const money = (n: number) => formatMoney(n, currency);

  return (
    <section className="tt-section">
      <div className="tt-section-head">
        <h2 className="tt-costs-heading">{t("costs.stockTitle")}</h2>
        {stock.ingredients.length > 0 && (
          <button type="button" className="tt-btn tt-btn-primary tt-btn-sm" onClick={() => setCounting(true)}>
            {t("costs.countAction")}
          </button>
        )}
      </div>
      <p className="tt-muted tt-costs-hint">{t("costs.stockHint")}</p>
      {ingredients.length > 1 && <input type="search" className="tt-input" aria-label={t("stockSearch.search")}
        placeholder={t("stockSearch.search")} value={search} onChange={e => setSearch(e.target.value)} />}
      {ingredients.length > 0 && visible.length === 0 && <p className="tt-muted">{t("stockSearch.empty")}</p>}
      {stock.ingredients.length === 0 ? (
        <p className="tt-muted">{t("costs.ingredientsEmpty")}</p>
      ) : (
        <ul className="tt-costs-products">
          {visible.map(i => {
            const now = stock.onHand[i.id];
            const shown = now === null || now === undefined ? null : inShown(now, i.unit);
            const last = stock.lastCounts[i.id];
            const diff = last && last.expected !== null ? Number(last.counted) - Number(last.expected) : null;
            const diffShown = diff === null ? null : inShown(Math.abs(diff), i.unit);
            return (
              <li key={i.id} className="tt-costs-entry">
                <span className="tt-costs-product-name">{i.name}</span>
                <span className={`tt-costs-margin ${shown && shown.amount < 0 ? "tt-costs-loss" : ""}`}>
                  {shown
                    ? t("costs.stockShould", { amount: `${amount(shown.amount)} ${t(`costs.unitShort.${shown.unit}`)}` })
                    : t("costs.stockUnknown")}
                </span>
                {last && (
                  <span className="tt-costs-product-meta tt-muted">
                    {t("costs.lastCount", { when: when(last.created_at), who: last.counted_by })}
                    {" · "}
                    {diff === null
                      ? t("costs.countFirst")
                      : Math.abs(diff) < 0.0005
                        ? t("costs.countMatch")
                        : t(diff < 0 ? "costs.countShort" : "costs.countOver", {
                            amount: `${amount(diffShown!.amount)} ${t(`costs.unitShort.${diffShown!.unit}`)}`,
                            cost: money(Math.abs(diff) * i.unit_cost),
                          })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <CountDialog open={counting} ingredients={ingredients} currency={currency} onClose={() => setCounting(false)} />
    </section>
  );
}
