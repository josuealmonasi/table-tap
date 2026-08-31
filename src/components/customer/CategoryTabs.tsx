"use client";

import type { Category } from "@/lib/types";
import { CouponIcon } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/context";

/** The horizontal scrollable category filter at the top of the menu. */
export default function CategoryTabs({
  categories,
  activeCat,
  onSelect,
  hasDeals = false,
}: {
  categories: Category[];
  activeCat: string;
  onSelect: (categoryId: string) => void;
  /** Whether there are combos, discounts or promotions to show. */
  hasDeals?: boolean;
}) {
  const t = useT();
  return (
    <div className="tt-cats">
      <button
        className={`tt-cat ${activeCat === "all" ? "tt-cat-on" : ""}`}
        onClick={() => onSelect("all")}
      >
        {t("menu.all")}
      </button>
      {/* Right after "Todo", in the offers colour: a combo is not a menu
          category and a restaurant should not have to invent one to make it
          visible. It only appears when there is something in it. */}
      {hasDeals && (
        <button
          className={`tt-cat tt-cat-deal ${activeCat === "deals" ? "tt-cat-on" : ""}`}
          onClick={() => onSelect("deals")}
        >
          <CouponIcon size={13} weight="bold" />
          {t("menu.deals")}
        </button>
      )}
      {categories.map(c => (
        <button
          key={c.id}
          className={`tt-cat ${activeCat === c.id ? "tt-cat-on" : ""}`}
          onClick={() => onSelect(c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}
