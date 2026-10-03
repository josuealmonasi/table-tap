"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import { fetchMenuData } from "@/lib/menu-data";
import type { Category, Menu, MenuItem } from "@/lib/types";
import { makeWriter } from "./menu-editor/writer";
import { menuActions } from "./menu-editor/menus";
import { productActions } from "./menu-editor/products";
import { addonActions } from "./menu-editor/addons";

export type { AddonInput, ProductInput } from "./menu-editor/types";

/**
 * Loads and mutates a restaurant's menus and their contents (sections,
 * products, add-on items, and product↔add-on links) directly via the
 * RLS-protected browser client — every write is authorised as the logged-in
 * owner. A restaurant can have several menus; each menu owns its own
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

  const reload = useCallback(async () => {
    const data = await fetchMenuData(supabase, restaurantId);
    setMenus(data.menus);
    setSections(data.sections);
    setProducts(data.products);
    setAddons(data.addons);
    setLinks(data.links);
    setLoading(false);
  }, [restaurantId, supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  const ctx = {
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
    w: makeWriter({ supabase, toast, t, reload }),
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
  };
}
