"use client";

import { useLocale, useT } from "@/lib/i18n/context";
import { tagLabel } from "@/lib/dietary";
import type { Category } from "@/lib/types";
import { CouponIcon, UsualIcon } from "@/components/ui/icons";
import { DEALS, USUAL } from "@/lib/menu-filter";
import type { MenuViewState } from "@/hooks/useMenuView";

interface MenuSideNavProps {
  view: MenuViewState;
  categories: Category[];
}

/**
 * Desktop only. With room for a column there's no reason to hide the
 * categories behind a scroller and the filters behind a button and a dialog —
 * both become a standing list you can see the state of, and picking one no
 * longer costs an open-and-dismiss. Hidden below 1025px, where the chip row
 * and the sheet are the right shapes.
 */
export default function MenuSideNav({ view, categories }: MenuSideNavProps) {
  const t = useT();
  const { locale: lang } = useLocale();
  const { activeCat, chooseCat, diet } = view;
  return (
    <aside className="tt-dish-side" aria-label={t("menu.filtersTitle")}>
      {!view.search.trim() && (
        <nav className="tt-side-nav">
          <button
            type="button"
            className={`tt-side-link ${activeCat === "all" ? "tt-side-link-on" : ""}`}
            onClick={() => chooseCat("all")}
          >
            {t("menu.all")}
          </button>
          {view.hasUsual && (
            <button
              type="button"
              className={`tt-side-link tt-side-link-usual ${activeCat === USUAL ? "tt-side-link-on" : ""}`}
              onClick={() => chooseCat(USUAL)}
            >
              <UsualIcon size={14} weight="bold" />
              {t("menu.usual")}
            </button>
          )}
          {/* On desktop the categories are this list, not the row of pills:
              adding the offers tab there and not here left it invisible on a
              large screen. */}
          {view.hasDeals && (
            <button
              type="button"
              className={`tt-side-link tt-side-link-deal ${activeCat === DEALS ? "tt-side-link-on" : ""}`}
              onClick={() => chooseCat(DEALS)}
            >
              <CouponIcon size={14} weight="bold" />
              {t("menu.deals")}
            </button>
          )}
          {categories.map(c => (
            <button
              key={c.id}
              type="button"
              className={`tt-side-link ${activeCat === c.id ? "tt-side-link-on" : ""}`}
              onClick={() => chooseCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </nav>
      )}
      {view.menuTags.length > 0 && (
        <div className="tt-side-group">
          <h3 className="tt-side-title">{t("menu.filtersTitle")}</h3>
          {view.menuTags.map(tag => (
            <label key={tag.key} className="tt-side-check">
              <input
                type="checkbox"
                checked={diet.includes(tag.key)}
                onChange={() => view.toggleDiet(tag.key)}
              />
              <span>
                {tag.emoji} {tagLabel(tag, t, lang)}
              </span>
            </label>
          ))}
          {diet.length > 0 && (
            <button
              type="button"
              className="tt-btn tt-btn-ghost tt-btn-sm"
              style={{ marginTop: 6, alignSelf: "flex-start", padding: "6px 0" }}
              onClick={view.clearDiet}
            >
              {t("menu.filtersClear")}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
