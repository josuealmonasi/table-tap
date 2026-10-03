"use client";

import type {
  Category,
  MenuItem,
  OrderLineItem,
  Restaurant,
  RestaurantTable,
} from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import MenuClosed from "./MenuClosed";
import type { Combo } from "@/lib/promotions";
import type { CartPromo } from "@/lib/pricing";
import CategoryTabs from "./CategoryTabs";
import ComboCard from "./ComboCard";
import MenuItemRow from "./MenuItemRow";
import CartBar from "./CartBar";
import UsualCard from "./UsualCard";
import MenuHeader from "./MenuHeader";
import MenuSideNav from "./MenuSideNav";
import DietFilterSheet from "./DietFilterSheet";
import type { LoyaltyOfferInfo } from "@/lib/loyalty/offer";
import { FiltersIcon } from "@/components/ui/icons";
import { useMenuView } from "@/hooks/useMenuView";
import { USUAL } from "@/lib/menu-filter";

/** The menu browsing screen: restaurant header, category filter, item list, cart bar. */
export default function MenuScreen({
  restaurant,
  table,
  categories,
  items,
  combos,
  promos,
  ratings,
  closedNow = false,
  orderAtRegister = false,
  cartCount,
  cartTotal,
  onSelectItem,
  onAddCombo,
  onOpenCart,
  notice,
  billDue = false,
  loyalty = null,
  usual = [],
  onAddUsual,
  onForgetUsual,
  onOpenBill,
  trackIds,
  onTrack,
}: {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  categories: Category[];
  items: MenuItem[];
  combos: Combo[];
  promos: CartPromo[];
  ratings: Record<string, { avg: number; count: number }>;
  /** No menu is serving at this hour — show why instead of an empty list. */
  closedNow?: boolean;
  /** Caja: the menu is to read, and the order is taken at the register. */
  orderAtRegister?: boolean;
  cartCount: number;
  cartTotal: number;
  onSelectItem: (item: MenuItem) => void;
  onAddCombo: (combo: Combo) => void;
  onOpenCart: () => void;
  /** The table has unpaid orders, so the bill is worth offering. */
  billDue?: boolean;
  /** The restaurant runs the visit card: the menu offers it, any time. */
  loyalty?: LoyaltyOfferInfo | null;
  /** What this phone usually orders here, as today's menu can still make it. */
  usual?: OrderLineItem[];
  onAddUsual?: () => void;
  onForgetUsual?: () => void;
  /** Something to say under the banners — the visit card, just after paying. */
  notice?: React.ReactNode;
  onOpenBill?: () => void;
  /** An order this phone placed and can still watch — shows the track link. */
  /** Every order this phone can still watch here, newest first. */
  trackIds?: string[];
  /** Opens the live status of one of them over this menu. */
  onTrack?: (orderId: string) => void;
}) {
  const t = useT();
  const view = useMenuView(restaurant, items, combos, promos, usual);
  const { activeCat, search, diet, filtered, shownCombos } = view;

  return (
    <div className="tt-root tt-root-wide">
      <MenuHeader
        restaurant={restaurant}
        table={table}
        loyalty={loyalty}
        view={view}
        orderAtRegister={orderAtRegister}
        billDue={billDue}
        onOpenBill={onOpenBill}
        trackIds={trackIds}
        onTrack={onTrack}
        notice={notice}
      />

      {/* Nothing orderable, for either reason. `closedNow` means the menus
          exist and none is serving; an empty item list with no closure means
          the restaurant has not built one yet. Both used to be told apart only
          by luck — the second painted a blank page. The filter strip goes too:
          there is nothing left to filter. */}
      {closedNow || (items.length === 0 && combos.length === 0) ? (
        <MenuClosed reason={closedNow ? "closed" : "empty"} />
      ) : (
        <>
          {/* Only this strip stays pinned while scrolling — the restaurant
              identity above scrolls away with the page. One row instead of
              three: categories scroll, filters live behind a button. Dietary
              tags matter to a minority but were eating a third of the screen
              before the first dish. */}
          <div className="tt-menu-sticky">
            {!search.trim() && (
              <CategoryTabs
                categories={categories}
                activeCat={activeCat}
                hasDeals={view.hasDeals}
                hasUsual={view.hasUsual}
                onSelect={view.chooseCat}
              />
            )}
            {view.menuTags.length > 0 && (
              <button
                type="button"
                className={`tt-filter-btn ${diet.length ? "tt-filter-btn-on" : ""}`}
                onClick={() => view.setFiltersOpen(true)}
                aria-label={t("menu.filters")}
                title={t("menu.filters")}
              >
                <FiltersIcon size={17} weight="bold" />
                {diet.length > 0 && (
                  <span className="tt-filter-count">{diet.length}</span>
                )}
              </button>
            )}
          </div>

          <DietFilterSheet
            open={view.filtersOpen}
            onClose={() => view.setFiltersOpen(false)}
            tags={view.menuTags}
            diet={diet}
            onToggle={view.toggleDiet}
            onClear={view.clearDiet}
          />

          <div className="tt-dish-layout">
            <MenuSideNav view={view} categories={categories} />

            <div className="tt-dish-main">
              {activeCat === USUAL && !search.trim() && onAddUsual && onForgetUsual && (
                <UsualCard
                  lines={usual}
                  onAdd={onAddUsual}
                  onForget={() => {
                    view.chooseCat("all");
                    onForgetUsual();
                  }}
                />
              )}
              {filtered.length === 0 &&
                shownCombos.length === 0 &&
                (search.trim() || diet.length > 0) && (
                  <p className="tt-muted" style={{ textAlign: "center", fontSize: 14 }}>
                    {search.trim()
                      ? t("menu.noSearchMatch", { q: search.trim() })
                      : t("menu.noDietMatch")}
                  </p>
                )}
              <div className="tt-dish-list">
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
                    promoLabel={view.promoNameOf.get(item.id)}
                    rating={ratings[item.id]}
                    onSelect={onSelectItem}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <CartBar
        count={cartCount}
        total={cartTotal}
        currency={restaurant.currency}
        onClick={onOpenCart}
      />
    </div>
  );
}
