"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Category, Menu, MenuItem } from "@/lib/types";

/** Editable fields for a product (a non-add-on menu item). */
export type ProductInput = {
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  emoji: string;
  popular: boolean;
};

/** Editable fields for an add-on item. */
export type AddonInput = {
  name: string;
  price: number;
  emoji: string;
};

/**
 * Loads and mutates a restaurant's menus and their contents (sections,
 * products, add-on items, and product↔add-on links) directly via the
 * RLS-protected browser client — every write is authorised as the logged-in
 * owner. A restaurant can have several menus; each menu owns its own
 * categories/products/extras (nothing is shared). Create operations take the
 * target menu id so rows land in the right menu.
 */
export function useMenuEditor(restaurantId: string) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [sections, setSections] = useState<Category[]>([]);
  const [products, setProducts] = useState<MenuItem[]>([]);
  const [addons, setAddons] = useState<MenuItem[]>([]);
  // product_id → addon_id[]
  const [links, setLinks] = useState<Record<string, string[]>>({});

  const reload = useCallback(async () => {
    const [{ data: menuRows }, { data: cats }, { data: items }] = await Promise.all([
      supabase.from("menus").select("*").eq("restaurant_id", restaurantId).order("sort_order"),
      supabase.from("categories").select("*").eq("restaurant_id", restaurantId).order("sort_order"),
      supabase.from("menu_items").select("*").eq("restaurant_id", restaurantId).order("sort_order"),
    ]);

    const allItems = (items as MenuItem[]) ?? [];
    const productList = allItems.filter((i) => !i.is_addon);
    setMenus((menuRows as Menu[]) ?? []);
    setSections((cats as Category[]) ?? []);
    setProducts(productList);
    setAddons(allItems.filter((i) => i.is_addon));

    const productIds = productList.map((p) => p.id);
    if (productIds.length) {
      const { data: linkRows } = await supabase
        .from("item_addons")
        .select("product_id, addon_id")
        .in("product_id", productIds);
      const map: Record<string, string[]> = {};
      for (const row of (linkRows as { product_id: string; addon_id: string }[]) ?? []) {
        (map[row.product_id] ??= []).push(row.addon_id);
      }
      setLinks(map);
    } else {
      setLinks({});
    }
    setLoading(false);
  }, [restaurantId, supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ── Menus ──
  async function addMenu(name: string): Promise<string | undefined> {
    const { data } = await supabase
      .from("menus")
      .insert({ restaurant_id: restaurantId, name, active: true, sort_order: menus.length })
      .select("id")
      .single();
    await reload();
    return (data as { id: string } | null)?.id;
  }
  async function renameMenu(id: string, name: string) {
    await supabase.from("menus").update({ name }).eq("id", id);
    await reload();
  }
  async function deleteMenu(id: string) {
    // Cascade deletes the menu's categories, products, extras and their links.
    await supabase.from("menus").delete().eq("id", id);
    await reload();
  }
  async function setMenuActive(id: string, active: boolean) {
    setMenus((prev) => prev.map((m) => (m.id === id ? { ...m, active } : m)));
    await supabase.from("menus").update({ active }).eq("id", id);
  }

  // ── Sections (categories) ──
  async function addSection(menuId: string, name: string): Promise<string | undefined> {
    const { data } = await supabase
      .from("categories")
      .insert({
        restaurant_id: restaurantId,
        menu_id: menuId,
        name,
        sort_order: sections.filter((s) => s.menu_id === menuId).length,
      })
      .select("id")
      .single();
    await reload();
    return (data as { id: string } | null)?.id;
  }
  async function renameSection(id: string, name: string) {
    await supabase.from("categories").update({ name }).eq("id", id);
    await reload();
  }
  async function deleteSection(id: string) {
    // Products in this section keep existing (category_id → null via FK).
    await supabase.from("categories").delete().eq("id", id);
    await reload();
  }

  // ── Products ──
  async function addProduct(
    menuId: string,
    categoryId: string | null,
    input: ProductInput
  ): Promise<string | undefined> {
    const { data } = await supabase
      .from("menu_items")
      .insert({
        restaurant_id: restaurantId,
        menu_id: menuId,
        category_id: categoryId,
        is_addon: false,
        sort_order: products.filter((p) => p.menu_id === menuId).length,
        ...input,
      })
      .select("id")
      .single();
    await reload();
    return (data as { id: string } | null)?.id;
  }
  async function updateProduct(id: string, input: Partial<ProductInput & { category_id: string | null }>) {
    await supabase.from("menu_items").update(input).eq("id", id);
    await reload();
  }
  async function deleteProduct(id: string) {
    await supabase.from("menu_items").delete().eq("id", id);
    await reload();
  }

  // ── Add-on items ──
  async function addAddon(menuId: string, input: AddonInput) {
    await supabase.from("menu_items").insert({
      restaurant_id: restaurantId,
      menu_id: menuId,
      category_id: null,
      is_addon: true,
      sort_order: addons.filter((a) => a.menu_id === menuId).length,
      ...input,
    });
    await reload();
  }
  async function updateAddon(id: string, input: Partial<AddonInput>) {
    await supabase.from("menu_items").update(input).eq("id", id);
    await reload();
  }
  async function deleteAddon(id: string) {
    await supabase.from("menu_items").delete().eq("id", id);
    await reload();
  }

  // ── Availability toggle (products and add-ons) — optimistic, no reload ──
  async function setAvailability(id: string, available: boolean) {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, available } : p)));
    setAddons((prev) => prev.map((a) => (a.id === id ? { ...a, available } : a)));
    await supabase.from("menu_items").update({ available }).eq("id", id);
  }

  // ── Which add-ons a product offers (replace the full set) ──
  async function setProductAddons(productId: string, addonIds: string[]) {
    await supabase.from("item_addons").delete().eq("product_id", productId);
    if (addonIds.length) {
      await supabase
        .from("item_addons")
        .insert(addonIds.map((addon_id, i) => ({ product_id: productId, addon_id, sort_order: i })));
    }
    await reload();
  }

  return {
    loading,
    menus,
    sections,
    products,
    addons,
    links,
    reload,
    addMenu,
    renameMenu,
    deleteMenu,
    setMenuActive,
    addSection,
    renameSection,
    deleteSection,
    addProduct,
    updateProduct,
    deleteProduct,
    addAddon,
    updateAddon,
    deleteAddon,
    setAvailability,
    setProductAddons,
  };
}
