"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Category, MenuItem, Restaurant, RestaurantTable } from "@/lib/types";
import { DIETARY_TAGS } from "@/lib/dietary";
import { recallOrder } from "@/lib/recent-order";
import { useT } from "@/lib/i18n/context";
import type { Combo } from "@/lib/promotions";
import type { CartPromo } from "@/lib/pricing";
import { Modal } from "@/components/ui/Modal";
import CategoryTabs from "./CategoryTabs";
import ComboCard from "./ComboCard";
import MenuItemRow from "./MenuItemRow";
import CartBar from "./CartBar";
import ServiceButtons from "./ServiceButtons";
import LanguageToggle from "./LanguageToggle";

/** The menu browsing screen: restaurant header, category filter, item list, cart bar. */
export default function MenuScreen({
  restaurant,
  table,
  categories,
  items,
  combos,
  promos,
  cartCount,
  cartTotal,
  onSelectItem,
  onAddCombo,
  onOpenCart,
}: {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  categories: Category[];
  items: MenuItem[];
  combos: Combo[];
  promos: CartPromo[];
  cartCount: number;
  cartTotal: number;
  onSelectItem: (item: MenuItem) => void;
  onAddCombo: (combo: Combo) => void;
  onOpenCart: () => void;
}) {
  const t = useT();
  const [activeCat, setActiveCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [diet, setDiet] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // An in-progress order for this restaurant on this device — lets the diner
  // hop back to its live status after returning to the menu to order more.
  const [trackId, setTrackId] = useState<string | null>(null);

  useEffect(() => {
    setTrackId(recallOrder(restaurant.id));
  }, [restaurant.id]);

  // Which dietary tags actually appear on this menu (so we only offer useful filters).
  const menuTags = useMemo(() => {
    const present = new Set(items.flatMap(i => i.dietary ?? []));
    return DIETARY_TAGS.filter(tag => present.has(tag.key));
  }, [items]);

  function toggleDiet(key: string): void {
    setDiet(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  }

  // Search spans the whole menu; the category tabs + dietary filter narrow it.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? items.filter(
          i =>
            i.name.toLowerCase().includes(q) ||
            (i.description ?? "").toLowerCase().includes(q),
        )
      : activeCat === "all"
        ? items
        : items.filter(i => i.category_id === activeCat);
    // An item must carry EVERY selected dietary tag (e.g. vegan AND gluten-free).
    if (diet.length) list = list.filter(i => diet.every(k => (i.dietary ?? []).includes(k)));
    return list;
  }, [activeCat, items, search, diet]);

  // item id → the deal covering it, so the row can advertise it. First deal
  // wins, matching how the pricing engine picks one deal per product.
  const promoByItem = useMemo(() => {
    const map = new Map<string, string>();
    for (const promo of promos) {
      for (const id of promo.itemIds) if (!map.has(id)) map.set(id, promo.name);
    }
    return map;
  }, [promos]);

  // Combos head the list. They're hidden under a dietary filter (a bundle has
  // no tags of its own, so we can't honestly claim it matches) and under a
  // category tab, since a bundle spans categories.
  const shownCombos = useMemo(() => {
    if (diet.length) return [];
    const q = search.trim().toLowerCase();
    if (q) return combos.filter(c => c.name.toLowerCase().includes(q));
    return activeCat === "all" ? combos : [];
  }, [combos, diet, search, activeCat]);

  return (
    <div className="tt-root">
      <div className="tt-menu-header">
        <div className="tt-row" style={{ alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 26 }}>{restaurant.logo}</div>
            <div className="tt-serif" style={{ fontSize: 22, fontWeight: 700 }}>
              {restaurant.name}
            </div>
            <div className="tt-sage" style={{ fontSize: 13 }}>
              {restaurant.tagline}
            </div>
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Search costs nothing until it's wanted — most diners browse. */}
              <button
                type="button"
                className="tt-icon-round"
                aria-label={t("menu.search")}
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen(o => !o)}
              >
                {searchOpen ? "✕" : "🔍"}
              </button>
              <LanguageToggle />
            </div>
            {table && (
              <span className="tt-badge tt-badge-onink">
                {t("menu.table", { label: table.label })}
              </span>
            )}
          </div>
        </div>

        {searchOpen && (
          <input
            className="tt-input tt-customer-search"
            type="search"
            placeholder={t("menu.search")}
            aria-label={t("menu.search")}
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        )}
        {table && <ServiceButtons restaurantId={restaurant.id} table={table} />}
        {trackId && (
          <Link href={`/order/${trackId}`} className="tt-track-banner" role="status">
            {t("menu.trackOrder")}
          </Link>
        )}
        {!restaurant.accepting_orders && (
          <div className="tt-closed-banner" role="status">
            {t("menu.closed")}
          </div>
        )}
      </div>

      {/* Only this strip stays pinned while scrolling — the restaurant
          identity above scrolls away with the page. */}
      {/* One row instead of three: categories scroll, filters live behind a
          button. Dietary tags matter to a minority but were eating a third of
          the screen before the first dish. */}
      <div className="tt-menu-sticky">
        {!search.trim() && (
          <CategoryTabs
            categories={categories}
            activeCat={activeCat}
            onSelect={setActiveCat}
          />
        )}
        {menuTags.length > 0 && (
          <button
            type="button"
            className={`tt-filter-btn ${diet.length ? "tt-filter-btn-on" : ""}`}
            onClick={() => setFiltersOpen(true)}
          >
            {t("menu.filters")}
            {diet.length > 0 && <span className="tt-filter-count">{diet.length}</span>}
          </button>
        )}
      </div>

      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        maxWidth={420}
        label={t("menu.filtersTitle")}
      >
        <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
          {t("menu.filtersTitle")}
        </h3>
        <div className="tt-diet-filter">
          {menuTags.map(tag => (
            <button
              key={tag.key}
              type="button"
              className={`tt-diet-chip ${diet.includes(tag.key) ? "tt-diet-chip-on" : ""}`}
              aria-pressed={diet.includes(tag.key)}
              onClick={() => toggleDiet(tag.key)}
            >
              {tag.emoji} {t(`dietary.${tag.key}`)}
            </button>
          ))}
        </div>
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 18 }}
        >
          <button
            type="button"
            className="tt-btn tt-btn-ghost tt-btn-sm"
            disabled={diet.length === 0}
            onClick={() => setDiet([])}
          >
            {t("menu.filtersClear")}
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-primary tt-btn-sm"
            onClick={() => setFiltersOpen(false)}
          >
            {t("menu.filtersDone")}
          </button>
        </div>
      </Modal>

      <div style={{ padding: 16 }}>
        {filtered.length === 0 && shownCombos.length === 0 && (search.trim() || diet.length > 0) && (
          <p className="tt-muted" style={{ textAlign: "center", fontSize: 14 }}>
            {search.trim()
              ? t("menu.noSearchMatch", { q: search.trim() })
              : t("menu.noDietMatch")}
          </p>
        )}
        {shownCombos.map(combo => (
          <ComboCard
            key={combo.id}
            combo={combo}
            currency={restaurant.currency}
            onAdd={onAddCombo}
          />
        ))}
        {filtered.map(item => (
          <MenuItemRow
            key={item.id}
            item={item}
            currency={restaurant.currency}
            promoLabel={promoByItem.get(item.id)}
            onSelect={onSelectItem}
          />
        ))}
      </div>

      <CartBar
        count={cartCount}
        total={cartTotal}
        currency={restaurant.currency}
        onClick={onOpenCart}
      />
    </div>
  );
}
