"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Category, MenuItem, Restaurant, RestaurantTable } from "@/lib/types";
import { DIETARY_TAGS } from "@/lib/dietary";
import { recallOrder } from "@/lib/recent-order";
import { useT } from "@/lib/i18n/context";
import type { Combo } from "@/lib/promotions";
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
  cartCount: number;
  cartTotal: number;
  onSelectItem: (item: MenuItem) => void;
  onAddCombo: (combo: Combo) => void;
  onOpenCart: () => void;
}) {
  const t = useT();
  const [activeCat, setActiveCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [diet, setDiet] = useState<string[]>([]);
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
            <LanguageToggle />
            {table && (
              <span className="tt-badge tt-badge-gold">
                {t("menu.table", { label: table.label })}
              </span>
            )}
          </div>
        </div>
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
      <div className="tt-menu-sticky">
        <input
          className="tt-input tt-customer-search"
          type="search"
          placeholder={t("menu.search")}
          aria-label={t("menu.search")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {!search.trim() && (
          <CategoryTabs
            categories={categories}
            activeCat={activeCat}
            onSelect={setActiveCat}
          />
        )}
        {menuTags.length > 0 && (
          <div className="tt-diet-filter">
            {menuTags.map(tag => (
              <button
                key={tag.key}
                type="button"
                className={`tt-diet-chip ${diet.includes(tag.key) ? "tt-diet-chip-on" : ""}`}
                onClick={() => toggleDiet(tag.key)}
              >
                {tag.emoji} {t(`dietary.${tag.key}`)}
              </button>
            ))}
          </div>
        )}
      </div>

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
