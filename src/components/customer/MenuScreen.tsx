"use client";

import { useMemo, useState } from "react";
import type { Category, MenuItem, Restaurant, RestaurantTable } from "@/lib/types";
import { DIETARY_TAGS } from "@/lib/dietary";
import CategoryTabs from "./CategoryTabs";
import MenuItemRow from "./MenuItemRow";
import CartBar from "./CartBar";
import ServiceButtons from "./ServiceButtons";

/** The menu browsing screen: restaurant header, category filter, item list, cart bar. */
export default function MenuScreen({
  restaurant,
  table,
  categories,
  items,
  cartCount,
  cartTotal,
  onSelectItem,
  onOpenCart,
}: {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  categories: Category[];
  items: MenuItem[];
  cartCount: number;
  cartTotal: number;
  onSelectItem: (item: MenuItem) => void;
  onOpenCart: () => void;
}) {
  const [activeCat, setActiveCat] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [diet, setDiet] = useState<string[]>([]);

  // Which dietary tags actually appear on this menu (so we only offer useful filters).
  const menuTags = useMemo(() => {
    const present = new Set(items.flatMap(i => i.dietary ?? []));
    return DIETARY_TAGS.filter(t => present.has(t.key));
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
          {table && (
            <span className="tt-badge tt-badge-gold">🪑 Table {table.label}</span>
          )}
        </div>
        {table && <ServiceButtons restaurantId={restaurant.id} table={table} />}
        {!restaurant.accepting_orders && (
          <div className="tt-closed-banner" role="status">
            ⏸️ We&apos;re not taking orders right now — please check back soon.
          </div>
        )}
      </div>

      {/* Only this strip stays pinned while scrolling — the restaurant
          identity above scrolls away with the page. */}
      <div className="tt-menu-sticky">
        <input
          className="tt-input tt-customer-search"
          type="search"
          placeholder="🔍 Search the menu…"
          aria-label="Search the menu"
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
            {menuTags.map(t => (
              <button
                key={t.key}
                type="button"
                className={`tt-diet-chip ${diet.includes(t.key) ? "tt-diet-chip-on" : ""}`}
                onClick={() => toggleDiet(t.key)}
              >
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: 16 }}>
        {filtered.length === 0 && (search.trim() || diet.length > 0) && (
          <p className="tt-muted" style={{ textAlign: "center", fontSize: 14 }}>
            {search.trim()
              ? `Nothing matches “${search.trim()}” — try another craving.`
              : "No items match those dietary filters."}
          </p>
        )}
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
