"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Category, MenuItem, Restaurant, RestaurantTable } from "@/lib/types";
import { tagLabel } from "@/lib/dietary";
import { useDietaryTags } from "@/components/DietaryTagsContext";
import { readMenuParams, syncMenuUrl } from "@/lib/menu-params";
import { useT, useLocale } from "@/lib/i18n/context";
import MenuClosed from "./MenuClosed";
import type { Combo } from "@/lib/promotions";
import type { CartPromo } from "@/lib/pricing";
import { Modal } from "@/components/ui/Modal";
import CategoryTabs from "./CategoryTabs";
import ComboCard from "./ComboCard";
import MenuItemRow from "./MenuItemRow";
import CartBar from "./CartBar";
import ServiceButtons from "./ServiceButtons";
import LanguageToggle from "./LanguageToggle";
import {
  CouponIcon,
  BillIcon,
  CloseIcon,
  FiltersIcon,
  SearchIcon,
  TableIcon,
} from "@/components/ui/icons";
import CoverBanner from "./CoverBanner";
import RestaurantMark, { hasMark } from "@/components/ui/RestaurantMark";

/** The menu browsing screen: restaurant header, category filter, item list, cart bar. */
/** The offers tab is not one of the restaurant's categories: it is ours. */
const DEALS = "deals";

export default function MenuScreen({
  restaurant,
  table,
  categories,
  items,
  combos,
  promos,
  ratings,
  closedNow = false,
  cartCount,
  cartTotal,
  onSelectItem,
  onAddCombo,
  onOpenCart,
  billDue = false,
  onOpenBill,
  trackId,
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
  cartCount: number;
  cartTotal: number;
  onSelectItem: (item: MenuItem) => void;
  onAddCombo: (combo: Combo) => void;
  onOpenCart: () => void;
  /** The table has unpaid orders, so the bill is worth offering. */
  billDue?: boolean;
  onOpenBill?: () => void;
  /** An order this phone placed and can still watch — shows the track link. */
  trackId?: string | null;
  /** Opens the live status of `trackId` over this menu. */
  onTrack?: () => void;
}) {
  const t = useT();
  const { locale: lang } = useLocale();
  const allTags = useDietaryTags();
  // The URL is the starting state, so a shared link and a reload both land on
  // the same view. Read once — after mount the address bar is an output, not
  // an input, or every keystroke would fight the field for control of it.
  const initial = readMenuParams(new URLSearchParams(useSearchParams().toString()));
  const [activeCat, setActiveCat] = useState<string>(initial.cat);
  const [search, setSearch] = useState(initial.q);
  const [searchOpen, setSearchOpen] = useState(Boolean(initial.q));
  const [diet, setDiet] = useState<string[]>(initial.diet);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Which dietary tags actually appear on this menu (so we only offer useful filters).
  const menuTags = useMemo(() => {
    const present = new Set(items.flatMap(i => i.dietary ?? []));
    return allTags.filter(tag => present.has(tag.key));
  }, [items, allTags]);

  function toggleDiet(key: string): void {
    setDiet(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      syncMenuUrl({ diet: next });
      return next;
    });
  }

  function chooseCat(id: string): void {
    setActiveCat(id);
    syncMenuUrl({ cat: id });
  }

  // Typing is debounced: the query only reaches the URL once you pause, so a
  // seven-letter dish name is one URL write rather than seven.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function changeSearch(value: string): void {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => syncMenuUrl({ q: value }), 350);
  }
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  // Which product carries an offer. Computed before the filter because the
  // offers tab needs it to decide what to show.
  const promoIds = useMemo(() => {
    const ids = new Set<string>();
    for (const promo of promos) for (const id of promo.itemIds) ids.add(id);
    return ids;
  }, [promos]);

  // There is something to show in Offers: a combo, a discounted dish, or one
  // inside a promotion. With none of that the tab does not appear — an empty
  // section is worse than no section.
  const hasDeals = useMemo(
    () =>
      restaurant.deals_tab_enabled !== false &&
      (combos.length > 0 ||
        items.some(i => Number(i.discount_pct) > 0 || promoIds.has(i.id))),
    [combos, items, promoIds, restaurant.deals_tab_enabled],
  );

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
        : activeCat === DEALS
          ? items.filter(i => Number(i.discount_pct) > 0 || promoIds.has(i.id))
          : items.filter(i => i.category_id === activeCat);
    // An item must carry EVERY selected dietary tag (e.g. vegan AND gluten-free).
    if (diet.length)
      list = list.filter(i => diet.every(k => (i.dietary ?? []).includes(k)));
    return list;
  }, [activeCat, items, search, diet, promoIds]);

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
    return activeCat === "all" || activeCat === DEALS ? combos : [];
  }, [combos, diet, search, activeCat]);

  const showCover = Boolean(restaurant.cover_enabled && restaurant.cover_url);

  // Over the photo when there is one, otherwise beside the search. It is the
  // one control a diner may need before reading anything, so it sits highest.
  const langToggle = <LanguageToggle />;

  // The search is a circle on a phone, on the name's line, and a field on a
  // wide screen, where the identity line has room to keep it open. Both write
  // the same query, so a resize keeps it.
  const searchBtn = (
    <button
      type="button"
      className="tt-icon-round tt-search-toggle"
      aria-label={t("menu.search")}
      aria-expanded={searchOpen}
      // Closing clears the query. Hiding the input while keeping the term left
      // the menu filtered with nothing on screen to say why — the categories
      // vanish under an active search, so a diner saw two dishes, no search
      // box, and no way back short of reloading.
      onClick={() => {
        if (searchOpen) changeSearch("");
        setSearchOpen(open => !open);
      }}
    >
      {searchOpen ? (
        <CloseIcon size={17} weight="bold" />
      ) : (
        <SearchIcon size={17} weight="bold" />
      )}
    </button>
  );

  const searchField = (
    <div className="tt-search-field">
      <SearchIcon size={17} weight="bold" />
      <input
        type="search"
        value={search}
        placeholder={t("menu.searchIn", { name: restaurant.name })}
        aria-label={t("menu.searchIn", { name: restaurant.name })}
        onChange={e => changeSearch(e.target.value)}
      />
    </div>
  );

  return (
    <div className="tt-root tt-root-wide">
      {/* Photo, floating controls and identity share one box on purpose: it is
          what the sticky controls are bounded by, so they pin while the photo
          and the name scroll under them and then hand over to the category bar
          at the bottom of it, which keeps its own behaviour unchanged. */}
      <div className="tt-cover-stack">
        {showCover && (
          <>
            <div className="tt-cover-controls">{langToggle}</div>
            <CoverBanner
              url={restaurant.cover_url}
              enabled={restaurant.cover_enabled}
              name={restaurant.name}
              priority
            />
          </>
        )}
        <div className="tt-menu-header">
          {hasMark(restaurant.logo_url, restaurant.logo) && (
            <div className="tt-brand-logo">
              <RestaurantMark
                logoUrl={restaurant.logo_url}
                emoji={restaurant.logo}
                name={restaurant.name}
              />
            </div>
          )}
          <div className="tt-row tt-brand-row">
            <div className="tt-serif tt-brand-name">{restaurant.name}</div>
            <div className="tt-head-controls">
              {!showCover && langToggle}
              {/* Only while something is owed — with nothing outstanding there
                  is no bill to look at, which is what made the old "get the
                  bill" button meaningless. */}
              {searchBtn}
              {searchField}
            </div>
          </div>
          <div className="tt-sage tt-brand-tagline">{restaurant.tagline}</div>
          {table && (
            <span className="tt-badge tt-badge-onink tt-table-badge">
              <TableIcon size={13} weight="bold" />
              {t("menu.table", { label: table.label })}
            </span>
          )}

          {searchOpen && (
            <input
              className="tt-input tt-customer-search"
              type="search"
              placeholder={t("menu.search")}
              aria-label={t("menu.search")}
              autoFocus
              value={search}
              onChange={e => changeSearch(e.target.value)}
            />
          )}
          {table && (
            <div className="tt-service-row">
              <ServiceButtons restaurantId={restaurant.id} table={table} />
              {/* Una sola puerta a la cuenta, y dice lo que hace. "Pedir la
                  cuenta" describe pedirle a alguien que traiga un papel; aquí
                  la cuenta se mira, y las dos formas de pagarla están dentro.
                  Sin nada que deber no aparece: una cuenta vacía no es una
                  pantalla que valga la pena abrir. */}
              {billDue && onOpenBill && (
                <button type="button" className="tt-service-btn" onClick={onOpenBill}>
                  <BillIcon size={16} weight="bold" />
                  {t("menu.myBill")}
                </button>
              )}
            </div>
          )}
          {trackId && onTrack && (
            // A button, not a link: the status opens over this menu rather
            // than taking the diner to a page of its own.
            <button type="button" className="tt-track-banner" onClick={onTrack}>
              <BillIcon size={14} weight="bold" /> {t("menu.trackOrder")}
            </button>
          )}
          {!restaurant.accepting_orders && (
            <div className="tt-closed-banner" role="status">
              {t("menu.closed")}
            </div>
          )}
        </div>
      </div>

      {/* Only this strip stays pinned while scrolling — the restaurant
          identity above scrolls away with the page. */}
      {/* One row instead of three: categories scroll, filters live behind a
          button. Dietary tags matter to a minority but were eating a third of
          the screen before the first dish. */}
      {/* Nothing is serving: say so instead of rendering an empty menu,
          which reads as a failed load. The filter strip goes too — there
          is nothing left to filter. */}
      {closedNow ? (
        <MenuClosed />
      ) : (
        <>
          <div className="tt-menu-sticky">
            {!search.trim() && (
              <CategoryTabs
                categories={categories}
                activeCat={activeCat}
                hasDeals={hasDeals}
                onSelect={chooseCat}
              />
            )}
            {menuTags.length > 0 && (
              <button
                type="button"
                className={`tt-filter-btn ${diet.length ? "tt-filter-btn-on" : ""}`}
                onClick={() => setFiltersOpen(true)}
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

          <Modal
            open={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            maxWidth={420}
            label={t("menu.filtersTitle")}
            variant="sheet"
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
                  {tag.emoji} {tagLabel(tag, t, lang)}
                </button>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 18,
              }}
            >
              <button
                type="button"
                className="tt-btn tt-btn-ghost tt-btn-sm"
                disabled={diet.length === 0}
                // Clearing leaves nothing to look at, so the sheet closes with it —
                // staying open just to show empty checkboxes makes the diner tap
                // twice to get back to the food.
                onClick={() => {
                  setDiet([]);
                  syncMenuUrl({ diet: [] });
                  setFiltersOpen(false);
                }}
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

          <div className="tt-dish-layout">
            {/* Desktop only. With room for a column there's no reason to hide the
              categories behind a scroller and the filters behind a button and a
              dialog — both become a standing list you can see the state of, and
              picking one no longer costs an open-and-dismiss. Hidden below
              1025px, where the chip row and the sheet are the right shapes. */}
            <aside className="tt-dish-side" aria-label={t("menu.filtersTitle")}>
              {!search.trim() && (
                <nav className="tt-side-nav">
                  <button
                    type="button"
                    className={`tt-side-link ${activeCat === "all" ? "tt-side-link-on" : ""}`}
                    onClick={() => chooseCat("all")}
                  >
                    {t("menu.all")}
                  </button>
                  {/* En escritorio las categorías son esta lista, no la fila
                      de pastillas: agregar la pestaña de ofertas allá y no
                      aquí la dejaba invisible en pantalla grande. */}
                  {hasDeals && (
                    <button
                      type="button"
                      className={`tt-side-link tt-side-link-deal ${
                        activeCat === DEALS ? "tt-side-link-on" : ""
                      }`}
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
              {menuTags.length > 0 && (
                <div className="tt-side-group">
                  <h3 className="tt-side-title">{t("menu.filtersTitle")}</h3>
                  {menuTags.map(tag => (
                    <label key={tag.key} className="tt-side-check">
                      <input
                        type="checkbox"
                        checked={diet.includes(tag.key)}
                        onChange={() => toggleDiet(tag.key)}
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
                      onClick={() => {
                        setDiet([]);
                        syncMenuUrl({ diet: [] });
                      }}
                    >
                      {t("menu.filtersClear")}
                    </button>
                  )}
                </div>
              )}
            </aside>

            <div className="tt-dish-main">
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
                    promoLabel={promoByItem.get(item.id)}
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
