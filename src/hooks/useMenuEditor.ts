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
  const [menus, setMenus] = useState<Menu[]>([]);
  const [sections, setSections] = useState<Category[]>([]);
  const [products, setProducts] = useState<MenuItem[]>([]);
  const [addons, setAddons] = useState<MenuItem[]>([]);
  // product_id → addon_id[]
  const [links, setLinks] = useState<Record<string, string[]>>({});

  const ready = useRef(false);
  const loadId = useRef(0);
  const reload = useCallback(async () => {
    const requestId = ++loadId.current;
    ready.current = false;
    setLoading(true);
    let data: Awaited<ReturnType<typeof fetchMenuData>>;
    try {
      data = await fetchMenuData(supabase, restaurantId);
    } catch (err) {
      if (requestId !== loadId.current) return;
      // Left loading, so nothing can be edited: an editor holding part of the
      // menu would save that part over the whole.
      console.error(err);
      toast(t("menu.loadFailed"), "error");
      return;
    }
    if (requestId !== loadId.current) return;
    setMenus(data.menus);
    setSections(data.sections);
    setProducts(data.products);
    setAddons(data.addons);
    setLinks(data.links);
    ready.current = true;
    setLoading(false);
  }, [restaurantId, supabase, toast, t]);

  const cancelReload = useCallback(() => {
    loadId.current++;
    ready.current = false;
  }, []);

  useEffect(() => {
    reload();
    return cancelReload;
  }, [reload, cancelReload]);

  const ctx = {
    ready: () => ready.current,
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
    w: makeWriter({ supabase, toast, t, reload, ready: () => ready.current }),
  };

  return {
    loading,
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
