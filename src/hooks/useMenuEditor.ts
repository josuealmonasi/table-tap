"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import { fetchMenuData } from "@/lib/menu-data";
import type { Category, Menu, MenuItem } from "@/lib/types";
import { makeWriter } from "./menu-editor/writer";
import { menuActions } from "./menu-editor/menus";
import { productActions } from "./menu-editor/products";
import { importActions } from "./menu-editor/import";
import { addonActions } from "./menu-editor/addons";
import type { MenuSnapshot } from "./menu-editor/types";

export type { AddonInput, ProductInput } from "./menu-editor/types";

/**
 * Loads and mutates a restaurant's menus and their contents (sections,
 * products, add-on items, and product↔add-on links) through the
 * RLS-protected browser client and manager routes — every write is authorised
 * as the logged-in manager. A restaurant can have several menus; each menu owns its own
 * categories/products/extras (nothing is shared). Create operations take the
 * target menu id so rows land in the right menu. Every mutation surfaces a
 * toast on failure; optimistic updates roll back if the write doesn't land.
 */
export function useMenuEditor(restaurantId: string) {
  const supabase = createClient();
  const toast = useToast();
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [sections, setSections] = useState<Category[]>([]);
  const [products, setProducts] = useState<MenuItem[]>([]);
  const [addons, setAddons] = useState<MenuItem[]>([]);
  // product_id → addon_id[]
  const [links, setLinks] = useState<Record<string, string[]>>({});

  const ready = useRef(false);
  const latest = useRef<MenuSnapshot>({ menus: [], sections: [], products: [], addons: [], links: {} });
  const loadId = useRef(0);
  // The read in flight. The menu stays on screen while it runs, so a click
  // there waits for it instead of being dropped without a word.
  const settled = useRef<Promise<void>>(Promise.resolve());
  const load = useCallback(async () => {
    const requestId = ++loadId.current;
    // Edits wait for the whole menu (J17), but the menu already on screen
    // stays there while it reloads after a save. Swapping it for skeletons
    // blanked the editor after every edit and threw the owner back to the top.
    ready.current = false;
    let data: Awaited<ReturnType<typeof fetchMenuData>>;
    try {
      data = await fetchMenuData(supabase, restaurantId);
    } catch (err) {
      if (requestId !== loadId.current) return;
      // Keep the last complete view and its drafts. Readiness stays false:
      // an editor holding part of the menu must never save it over the whole.
      console.error(err);
      setLoadFailed(true);
      setLoading(false);
      toast(t("menu.loadFailed"), "error");
      return;
    }
    if (requestId !== loadId.current) return;
    latest.current = data;
    setMenus(data.menus);
    setSections(data.sections);
    setProducts(data.products);
    setAddons(data.addons);
    setLinks(data.links);
    setLoadFailed(false);
    setHasLoaded(true);
    ready.current = true;
    setLoading(false);
  }, [restaurantId, supabase, toast, t]);

  const reload = useCallback(() => {
    const read = load();
    settled.current = read.catch(() => {});
    return read;
  }, [load]);

  /** True once the latest read holds the whole menu; false if it failed. */
  const whenReady = useCallback(async () => {
    // A save can start another read while this one finishes: wait for the last.
    for (let seen = settled.current; ; seen = settled.current) {
      await seen;
      if (seen === settled.current) return ready.current;
    }
  }, []);

  const cancelReload = useCallback(() => {
    loadId.current++;
    ready.current = false;
  }, []);

  useEffect(() => {
    reload();
    return cancelReload;
  }, [reload, cancelReload]);

  const ctx = {
    ready: whenReady,
    latest,
    supabase,
    restaurantId,
    toast,
    t,
    menus,
    sections,
    products,
    addons,
    links,
    setMenus,
    setProducts,
    setAddons,
    reload,
    w: makeWriter({ supabase, toast, t, reload, ready: whenReady, latest }),
  };

  return {
    loading,
    loadFailed,
    hasLoaded,
    menus,
    sections,
    products,
    addons,
    links,
    reload,
    ...menuActions(ctx),
    ...productActions(ctx),
    ...addonActions(ctx),
    ...importActions(ctx),
  };
}
