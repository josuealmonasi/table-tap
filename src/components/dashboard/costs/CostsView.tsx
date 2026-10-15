"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";

export const COSTS_TABS = ["margins", "ingredients", "waste", "stock", "buy"] as const;
export type CostsTab = (typeof COSTS_TABS)[number];

const LABEL: Record<CostsTab, string> = {
  margins: "costs.tabMargins",
  ingredients: "costs.tabIngredients",
  waste: "costs.tabWaste",
  stock: "costs.tabStock",
  buy: "costs.tabBuy",
};

interface CostsViewProps {
  tab: CostsTab;
  children: React.ReactNode;
}

/**
 * The costs screen's frame: what each product leaves, the ingredients it is
 * built from, what was thrown away, what the shelf should hold, and what to
 * buy. Each tab is its own page, so each reads only what it shows.
 */
export default function CostsView({ tab, children }: CostsViewProps) {
  const t = useT();
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.costs" }]} />
        </header>
        <nav className="tt-board-tabs tt-costs-tabs" aria-label={t("nav.costs")}>
          {COSTS_TABS.map(key => (
            <Link
              key={key}
              href={key === "margins" ? "/dashboard/costs" : `/dashboard/costs?tab=${key}`}
              className={`tt-board-tab ${key === tab ? "tt-board-tab-active" : ""}`}
              aria-current={key === tab ? "page" : undefined}
            >
              {t(LABEL[key])}
            </Link>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
