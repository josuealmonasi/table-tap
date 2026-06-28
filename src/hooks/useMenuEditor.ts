"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Category, MenuItem } from "@/lib/types";

/** Editable fields for a product (a non-add-on menu item). */
export type ProductInput = {
  name: string;
  description: string;
  price: number;
  emoji: string;
  image_url: string | null;
  popular: boolean;
};

/** Editable fields for an add-on item. */
export type AddonInput = {
  name: string;
  price: number;
  emoji: string;
};

/**
 * Loads and mutates a restaurant's menu (sections, products, add-on items, and
 * product↔add-on links) directly via the RLS-protected browser client — every
 * write is authorised as the logged-in owner. Reloads after structural changes.
 */
export function useMenuEditor(restaurantId: string) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState<Category[]>([]);
  const [products, setProducts] = useState<MenuItem[]>([]);
  const [addons, setAddons] = useState<MenuItem[]>([]);
  // product_id → addon_id[]
  const [links, setLinks] = useState<Record<string, string[]>>({});

  const reload = useCallback(async () => {
    const [{ data: cats }, { data: items }] = await Promise.all([
      supabase.from("categories").select("*").eq("restaurant_id", restaurantId).order("sort_order"),
      supabase.from("menu_items").select("*").eq("restaurant_id", restaurantId).order("sort_order"),
    ]);

    const allItems = (items as MenuItem[]) ?? [];
    const productList = allItems.filter((i) => !i.is_addon);
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

  // ── Sections (categories) ──
  async function addSection(name: string) {
    await supabase.from("categories").insert({
      restaurant_id: restaurantId,
      name,
      sort_order: sections.length,
    });
    await reload();
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
  async function addProduct(categoryId: string | null, input: ProductInput): Promise<string | undefined> {
    const { data } = await supabase
      .from("menu_items")
      .insert({
        restaurant_id: restaurantId,
        category_id: categoryId,
        is_addon: false,
        sort_order: products.length,
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
  async function addAddon(input: AddonInput) {
    await supabase.from("menu_items").insert({
      restaurant_id: restaurantId,
      category_id: null,
      is_addon: true,
      sort_order: addons.length,
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
    sections,
    products,
    addons,
    links,
    reload,
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
