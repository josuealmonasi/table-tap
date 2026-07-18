"use client";

import type { Category } from "@/lib/types";
import { useT } from "@/lib/i18n/context";

/** The horizontal scrollable category filter at the top of the menu. */
export default function CategoryTabs({
  categories,
  activeCat,
  onSelect,
}: {
  categories: Category[];
  activeCat: string;
  onSelect: (categoryId: string) => void;
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
