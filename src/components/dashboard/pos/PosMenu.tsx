"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import StockTag from "@/components/dashboard/StockTag";
import type { Combo } from "@/lib/promotions";
import type { MenuItem } from "@/lib/types";
import { posSectionId, type PosSection } from "@/lib/pos-sections";

interface PosMenuProps {
  sections: PosSection[];
  combos: Combo[];
  search: string;
  onSearch: (value: string) => void;
  /** A sale is in flight or its ticket is up: nothing is to be tapped. */
  sending: boolean;
  currency: string;
  /** A tile tapped: added at once when there is nothing to choose, else opened. */
  onOpenItem: (item: MenuItem) => void;
  onOpenCombo: (combo: Combo) => void;
  /** The dishes that sell most, most first, shown on top. */
  bestSellers?: MenuItem[];
  /** How many of each dish the sale holds, by id. */
  inSale?: Map<string, number>;
}

/** What is for sale, by section, one tap to add. */
export default function PosMenu({
  sections,
  combos,
  search,
  onSearch,
  sending,
  currency,
  onOpenItem,
  onOpenCombo,
  bestSellers = [],
  inSale = new Map(),
}: PosMenuProps) {
  const t = useT();
  const money = (n: number) => formatMoney(n, currency);
  const searching = search.trim().length > 0;

  /** One dish, one tap. Says how many the sale already has. */
  const tile = (dish: MenuItem) => {
    const held = inSale.get(dish.id) ?? 0;
    return (
      <button
        type="button"
        key={dish.id}
        className={`tt-pos-tile ${dish.available ? "" : "tt-pos-tile-out"}`}
        disabled={!dish.available}
        onClick={() => onOpenItem(dish)}
      >
        <span className="tt-pos-tile-name">
          {dish.emoji} {dish.name}
        </span>
        {dish.available ? (
          <span className="tt-pos-tile-foot">
            <span className="tt-pos-tile-price">{money(Number(dish.price))}</span>
            {/* Only where there is a limit to know about. */}
            <StockTag left={dish.stock} />
          </span>
        ) : (
          <span className="tt-badge tt-pos-tile-out-tag">{t("cart.soldOut")}</span>
        )}
        {held > 0 && (
          <span className="tt-pos-tile-count" aria-label={t("pos.inSale", { n: held })}>
            ×{held}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className={`tt-pos-menu ${sending ? "tt-pos-menu-sending" : ""}`}
      aria-busy={sending}
    >
      <input
        className="tt-input tt-pos-search"
        value={search}
        onChange={e => onSearch(e.target.value)}
        placeholder={t("pos.search")}
        aria-label={t("pos.search")}
      />

      {/* Jumps to a section without hiding the rest: a cashier who knows
          where a dish is goes straight there, and one who does not can
          still scroll past everything the way they always could. */}
      {sections.length > 1 && (
        <nav className="tt-pos-jump" aria-label={t("pos.sections")}>
          {sections.map(({ name }) => (
            <button
              type="button"
              key={name}
              onClick={() =>
                document
                  .getElementById(posSectionId(name))
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              {name}
            </button>
          ))}
        </nav>
      )}

      {/* What actually sells, first: the queue in a morning rush is mostly
          the same eight things, and a new cashier should not have to know
          which section each one lives in. */}
      {bestSellers.length > 0 && !searching && (
        <section id="pos-best" className="tt-pos-section">
          <h3 className="tt-pos-cat">{t("pos.bestSellers")}</h3>
          <div className="tt-pos-grid">{bestSellers.map(tile)}</div>
        </section>
      )}

      {combos.length > 0 && !searching && (
        <section id="pos-combos" className="tt-pos-section">
          <h3 className="tt-pos-cat">{t("menu.deals")}</h3>
          <div className="tt-pos-grid">
            {combos.map(combo => (
              <button
                type="button"
                key={combo.id}
                className="tt-pos-tile"
                onClick={() => onOpenCombo(combo)}
              >
                <span className="tt-pos-tile-name">{combo.name}</span>
                <span className="tt-pos-tile-price">{money(combo.price)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {sections.map(({ name, dishes }) => (
        <section key={name} id={posSectionId(name)} className="tt-pos-section">
          <h3 className="tt-pos-cat">{name}</h3>
          <div className="tt-pos-grid">{dishes.map(tile)}</div>
        </section>
      ))}
      {sections.length === 0 && <p className="tt-muted">{t("pos.noMatch")}</p>}
    </div>
  );
}
