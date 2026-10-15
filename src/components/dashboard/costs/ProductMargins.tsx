"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { percent } from "@/lib/costs/display";
import type { PeriodContribution, UnitMargin } from "@/lib/costs/margins";
import type { CostedProduct } from "@/lib/costs/server";

interface ProductMarginsProps {
  margins: UnitMargin[];
  products: CostedProduct[];
  period: PeriodContribution;
  currency: string;
  onOpen: (itemId: string) => void;
}

/**
 * Every product with what one leaves, the thinnest first and those with no
 * recipe last, and what the period's sales of it left. A restaurant with more
 * than one menu often repeats a name across them, so each row says its menu
 * and the list can be narrowed to one.
 */
export default function ProductMargins({ margins, products, period, currency, onOpen }: ProductMarginsProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState("");
  const money = (n: number) => formatMoney(n, currency);
  const menuOf = useMemo(() => new Map(products.map(p => [p.id, p.menuName ?? ""])), [products]);
  const sold = useMemo(() => new Map(period.rows.map(r => [r.key, r])), [period.rows]);
  const menus = useMemo(() => [...new Set(products.map(p => p.menuName).filter((m): m is string => Boolean(m)))].sort(), [products]);

  const shown = margins.filter(m => {
    const q = query.trim().toLowerCase();
    return (!q || m.name.toLowerCase().includes(q)) && (!menu || menuOf.get(m.itemId) === menu);
  });

  return (
    <section className="tt-section">
      <h2 className="tt-costs-heading">{t("costs.productsTitle")}</h2>
      <p className="tt-muted tt-costs-hint">{t("costs.productsHint")}</p>
      {margins.length === 0 ? (
        <p className="tt-muted">{t("costs.noProducts")}</p>
      ) : (
        <>
          <div className="tt-costs-filters">
            <input
              className="tt-input"
              placeholder={t("costs.search")}
              aria-label={t("costs.search")}
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {menus.length > 1 && (
              <select className="tt-input" aria-label={t("costs.allMenus")} value={menu} onChange={e => setMenu(e.target.value)}>
                <option value="">{t("costs.allMenus")}</option>
                {menus.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </div>
          <ul className="tt-costs-products">
            {shown.map(m => {
              const s = sold.get(m.itemId);
              return (
                <li key={m.itemId}>
                  <button type="button" className="tt-costs-product" onClick={() => onOpen(m.itemId)}>
                    <span className="tt-costs-product-name">
                      <span aria-hidden="true">{m.emoji}</span> {m.name}
                      {menus.length > 1 && menuOf.get(m.itemId) && <small className="tt-muted"> · {menuOf.get(m.itemId)}</small>}
                    </span>
                    {m.margin === null ? (
                      <span className="tt-costs-chip">{t("costs.noRecipe")}</span>
                    ) : (
                      <span className={`tt-costs-margin ${m.margin < 0 ? "tt-costs-loss" : ""}`}>
                        {t("costs.leaves", { amount: money(m.margin), pct: m.marginPct === null ? "—" : percent(m.marginPct) })}
                      </span>
                    )}
                    <span className="tt-costs-product-meta tt-muted">
                      {money(m.price)}
                      {m.cost !== null && ` · ${t("costs.costs", { cost: money(m.cost) })}`}
                      {s && ` · ${s.complete ? t("costs.sold", { n: s.units, amount: money(s.contribution) }) : t("costs.soldOnly", { n: s.units })}`}
                    </span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="tt-muted">{t("costs.noMatch")}</li>}
          </ul>
        </>
      )}
    </section>
  );
}
