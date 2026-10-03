"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { MenuItem, OrderLineItem, Restaurant } from "@/lib/types";
import type { Combo } from "@/lib/promotions";
import type { CartPromo } from "@/lib/pricing";
import { useDietaryTags } from "@/components/DietaryTagsContext";
import { readMenuParams, syncMenuUrl } from "@/lib/menu-params";
import {
  USUAL,
  filterCombos,
  filterDishes,
  menuHasDeals,
  promoIndex,
} from "@/lib/menu-filter";

/**
 * What the diner is looking at on the menu: the category, the search, the
 * dietary filter — and what that leaves on screen.
 *
 * The URL is the starting state, so a shared link and a reload both land on
 * the same view. Read once — after mount the address bar is an output, not an
 * input, or every keystroke would fight the field for control of it.
 */
export function useMenuView(
  restaurant: Pick<Restaurant, "deals_tab_enabled">,
  items: MenuItem[],
  combos: Combo[],
  promos: CartPromo[],
  usual: OrderLineItem[],
) {
  const allTags = useDietaryTags();
  const initial = readMenuParams(new URLSearchParams(useSearchParams().toString()));
  const [chosenCat, setActiveCat] = useState<string>(initial.cat);
  // "Lo de siempre" is a tab only while there is a usual to show: a link that
  // named it, or one just forgotten, lands on the whole menu instead.
  const hasUsual = usual.length > 0;
  const activeCat = chosenCat === USUAL && !hasUsual ? "all" : chosenCat;
  const usualIds = useMemo(() => new Set(usual.map(l => l.itemId)), [usual]);
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

  function clearDiet(): void {
    setDiet([]);
    syncMenuUrl({ diet: [] });
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
  const promoIdx = useMemo(() => promoIndex(promos), [promos]);
  const hasDeals = useMemo(
    () => menuHasDeals(restaurant.deals_tab_enabled, combos, items, promoIdx.ids),
    [combos, items, promoIdx, restaurant.deals_tab_enabled],
  );
  const filtered = useMemo(
    () => filterDishes(items, { search, activeCat, diet }, promoIdx.ids, usualIds),
    [activeCat, items, search, diet, promoIdx, usualIds],
  );
  const shownCombos = useMemo(
    () => filterCombos(combos, { search, activeCat, diet }),
    [combos, diet, search, activeCat],
  );

  return {
    activeCat,
    chooseCat,
    hasUsual,
    hasDeals,
    search,
    changeSearch,
    searchOpen,
    setSearchOpen,
    diet,
    toggleDiet,
    clearDiet,
    filtersOpen,
    setFiltersOpen,
    menuTags,
    filtered,
    shownCombos,
    promoNameOf: promoIdx.nameOf,
  };
}

export type MenuViewState = ReturnType<typeof useMenuView>;
