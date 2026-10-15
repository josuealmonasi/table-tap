"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";
import type { CostsView as CostsData } from "@/lib/costs/server";
import MarginsPanel from "./MarginsPanel";
import IngredientsPanel from "./IngredientsPanel";

export type CostsTab = "margins" | "ingredients";

interface CostsViewProps {
  view: CostsData;
  tab: CostsTab;
  currency: string;
}

/** The costs screen: margins first, the ingredients they are built from second. */
export default function CostsView({ view, tab, currency }: CostsViewProps) {
  const t = useT();
  const tabs: { key: CostsTab; href: string; label: string }[] = [
    { key: "margins", href: "/dashboard/costs", label: t("costs.tabMargins") },
    { key: "ingredients", href: "/dashboard/costs?tab=ingredients", label: t("costs.tabIngredients") },
  ];
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.costs" }]} />
        </header>
        <nav className="tt-board-tabs" aria-label={t("nav.costs")}>
          {tabs.map(x => (
            <Link
              key={x.key}
              href={x.href}
              className={`tt-board-tab ${x.key === tab ? "tt-board-tab-active" : ""}`}
              aria-current={x.key === tab ? "page" : undefined}
            >
              {x.label}
            </Link>
          ))}
        </nav>
        {tab === "margins" ? (
          <MarginsPanel view={view} currency={currency} />
        ) : (
          <IngredientsPanel ingredients={view.ingredients} recipes={view.recipes} currency={currency} />
        )}
      </div>
    </div>
  );
}
