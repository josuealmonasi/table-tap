"use client";

import { useMemo, useState } from "react";
import type { Category, MenuItem, Restaurant, RestaurantTable } from "@/lib/types";
import CategoryTabs from "./CategoryTabs";
import MenuItemRow from "./MenuItemRow";
import CartBar from "./CartBar";

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

  const filtered = useMemo(
    () => (activeCat === "all" ? items : items.filter((i) => i.category_id === activeCat)),
    [activeCat, items]
  );

  return (
    <div className="tt-root">
      <div className="tt-menu-header">
        <div className="tt-row" style={{ alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 26 }}>{restaurant.logo}</div>
            <div className="tt-serif" style={{ fontSize: 22, fontWeight: 700 }}>
              {restaurant.name}
            </div>
            <div className="tt-sage" style={{ fontSize: 13 }}>{restaurant.tagline}</div>
          </div>
          {table && <span className="tt-badge tt-badge-gold">🪑 Table {table.label}</span>}
        </div>
        {!restaurant.accepting_orders && (
          <div className="tt-closed-banner" role="status">
            ⏸️ We&apos;re not taking orders right now — please check back soon.
          </div>
        )}
        <CategoryTabs categories={categories} activeCat={activeCat} onSelect={setActiveCat} />
      </div>

      <div style={{ padding: 16 }}>
        {filtered.map((item) => (
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
