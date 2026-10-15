"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import type { CostsView } from "@/lib/costs/server";
import PeriodSummary from "./PeriodSummary";
import PriceRises from "./PriceRises";
import FeeCard from "./FeeCard";
import ProductMargins from "./ProductMargins";
import RecipeDialog from "./RecipeDialog";

interface MarginsPanelProps {
  view: CostsView;
  currency: string;
}

/**
 * What the products leave: the period first, then anything that just got
 * more expensive, then the fee the margins assume, then each product — whose
 * recipe opens from its row.
 */
export default function MarginsPanel({ view, currency }: MarginsPanelProps) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const product = view.products.find(p => p.id === editing) ?? null;
  const hasRecipes = view.recipes.length > 0;

  return (
    <>
      <p className="tt-muted tt-costs-intro">{t("costs.intro")}</p>
      {hasRecipes ? (
        <PeriodSummary period={view.period} currency={currency} />
      ) : (
        <section className="tt-section tt-costs-start">
          <p>{t("costs.noRecipes")}</p>
          <Link href="/dashboard/costs?tab=ingredients" className="tt-btn tt-btn-primary tt-btn-sm">
            {t("costs.startIngredients")}
          </Link>
        </section>
      )}
      {view.rises.length > 0 && <PriceRises rises={view.rises} currency={currency} />}
      <FeeCard fees={view.fees} terminalFeePct={view.terminalFeePct} currency={currency} />
      <ProductMargins
        margins={view.margins}
        products={view.products}
        period={view.period}
        currency={currency}
        onOpen={setEditing}
      />
      <RecipeDialog
        product={product}
        ingredients={view.ingredients}
        recipes={view.recipes}
        feeRate={view.fees.rate}
        taxPct={view.taxPct}
        currency={currency}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
