"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import {
  fetchMenuData,
  reorderRows,
  type Reorderable,
  type ReorderTable,
} from "@/lib/menu-data";
import { duplicateMenuDeep } from "@/lib/menu-duplicate";
import type { Category, Menu, MenuItem, Modifier } from "@/lib/types";

/** Editable fields for a product (a non-add-on menu item). */
export interface ProductInput {
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  emoji: string;
  popular: boolean;
  /** Option groups the customer picks from (e.g. "Spice level"). */
  modifiers: Modifier[];
  /** Dietary / allergen tag keys (see src/lib/dietary.ts). */
  dietary: string[];
}

/** Editable fields for an add-on item. */
export interface AddonInput {
  name: string;
  price: number;
  emoji: string;
}

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

  /** Reports a failed write to the user. Used by every mutation below. */
  function reportError(action: string, error: { message: string } | null): boolean {
    if (error) toast(`Couldn't ${action}: ${error.message}`, "error");
    return !error;
  }

  /** Runs a write, reports any failure, then refreshes local state. */
  async function run(
    action: string,
    write: PromiseLike<{ error: { message: string } | null }>,
  ): Promise<void> {
    const { error } = await write;
    reportError(action, error);
    await reload();
  }

  /** Inserts a row, reports any failure, refreshes, and returns the new row's id. */
  async function insertReturningId(
    action: string,
    table: ReorderTable,
    row: Record<string, unknown>,
  ): Promise<string | undefined> {
    const { data, error } = await supabase.from(table).insert(row).select("id").single();
    if (!reportError(action, error)) return undefined;
    await reload();
    return (data as { id: string } | null)?.id;
  }

  /** Moves a row one step among its siblings, reporting any failure. */
  async function move(
    action: string,
    table: ReorderTable,
    siblings: Reorderable[],
    id: string,
    direction: "up" | "down",
  ): Promise<void> {
    reportError(action, await reorderRows(supabase, table, siblings, id, direction));
    await reload();
  }

  // ── Menus ──
  const addMenu = (name: string) =>
    insertReturningId("create the menu", "menus", {
      restaurant_id: restaurantId,
      name,
      active: true,
      sort_order: menus.length,
    });
  const renameMenu = (id: string, name: string) =>
    run("rename the menu", supabase.from("menus").update({ name }).eq("id", id));
  // Cascade deletes the menu's categories, products, extras and their links.
  const deleteMenu = (id: string) =>
    run("delete the menu", supabase.from("menus").delete().eq("id", id));
  const moveMenu = (id: string, direction: "up" | "down") =>
    move("reorder menus", "menus", menus, id, direction);

  async function setMenuActive(id: string, active: boolean): Promise<void> {
    const prev = menus;
    setMenus(m => m.map(x => (x.id === id ? { ...x, active } : x)));
    const { error } = await supabase.from("menus").update({ active }).eq("id", id);
    if (error) {
      setMenus(prev); // roll back the optimistic flip
      reportError("update that menu", error);
    }
  }

  /** Deep-copies a menu: its sections, products, extras, and add-on links. Returns the new menu's id. */
  async function duplicateMenu(id: string): Promise<string | undefined> {
    const result = await duplicateMenuDeep(supabase, {
      restaurantId,
      sourceId: id,
      menus,
      sections,
      products,
      addons,
      links,
      reportError,
    });
    if (!result) return undefined;
    await reload();
    toast(`Duplicated as “${result.copyName}”`);
    return result.newMenuId;
  }

  // ── Sections (categories) ──
  const addSection = (menuId: string, name: string) =>
    insertReturningId("create the section", "categories", {
      restaurant_id: restaurantId,
      menu_id: menuId,
      name,
      sort_order: sections.filter(s => s.menu_id === menuId).length,
    });
  const renameSection = (id: string, name: string) =>
    run("rename the section", supabase.from("categories").update({ name }).eq("id", id));
  // Products in a deleted section keep existing (category_id → null via FK).
  const deleteSection = (id: string) =>
    run("delete the section", supabase.from("categories").delete().eq("id", id));

  async function moveSection(id: string, direction: "up" | "down"): Promise<void> {
    const section = sections.find(s => s.id === id);
    if (!section) return;
    const siblings = sections.filter(s => s.menu_id === section.menu_id);
    await move("reorder sections", "categories", siblings, id, direction);
  }

  // ── Products ──
  const addProduct = (menuId: string, categoryId: string | null, input: ProductInput) =>
    insertReturningId("create the product", "menu_items", {
      restaurant_id: restaurantId,
      menu_id: menuId,
      category_id: categoryId,
      is_addon: false,
      sort_order: products.filter(p => p.menu_id === menuId).length,
      ...input,
    });
  const updateProduct = (
    id: string,
    input: Partial<ProductInput & { category_id: string | null }>,
  ) => run("update the product", supabase.from("menu_items").update(input).eq("id", id));
  const deleteProduct = (id: string) =>
    run("delete the product", supabase.from("menu_items").delete().eq("id", id));

  /** Moves a product up/down among its siblings (same menu + same section, including "uncategorized"). */
  async function moveProduct(id: string, direction: "up" | "down"): Promise<void> {
    const product = products.find(p => p.id === id);
    if (!product) return;
    const sectionIds = new Set(sections.map(s => s.id));
    const inSameGroup = (p: MenuItem) =>
      p.menu_id === product.menu_id &&
      (product.category_id && sectionIds.has(product.category_id)
        ? p.category_id === product.category_id
        : !p.category_id || !sectionIds.has(p.category_id));
    await move(
      "reorder products",
      "menu_items",
      products.filter(inSameGroup),
      id,
      direction,
    );
  }

  // ── Add-on items ──
  const addAddon = (menuId: string, input: AddonInput) =>
    run(
      "create the extra",
      supabase.from("menu_items").insert({
        restaurant_id: restaurantId,
        menu_id: menuId,
        category_id: null,
        is_addon: true,
        sort_order: addons.filter(a => a.menu_id === menuId).length,
        ...input,
      }),
    );
  const updateAddon = (id: string, input: Partial<AddonInput>) =>
    run("update the extra", supabase.from("menu_items").update(input).eq("id", id));
  const deleteAddon = (id: string) =>
    run("delete the extra", supabase.from("menu_items").delete().eq("id", id));

  /** Bulk delete: removes any mix of products and extras in one call. */
  const deleteItems = (ids: string[]) =>
    run("delete the selected items", supabase.from("menu_items").delete().in("id", ids));

  async function moveAddon(id: string, direction: "up" | "down"): Promise<void> {
    const addon = addons.find(a => a.id === id);
    if (!addon) return;
    const siblings = addons.filter(a => a.menu_id === addon.menu_id);
    await move("reorder extras", "menu_items", siblings, id, direction);
  }

  // ── Availability toggle (products and add-ons) — optimistic, rolls back on failure ──
  async function setAvailability(id: string, available: boolean): Promise<void> {
    const prevProducts = products;
    const prevAddons = addons;
    setProducts(prev => prev.map(p => (p.id === id ? { ...p, available } : p)));
    setAddons(prev => prev.map(a => (a.id === id ? { ...a, available } : a)));
    const { error } = await supabase
      .from("menu_items")
      .update({ available })
      .eq("id", id);
    if (error) {
      setProducts(prevProducts);
      setAddons(prevAddons);
      reportError("update availability", error);
    }
  }

  // ── Which add-ons a product offers (replace the full set) ──
  async function setProductAddons(productId: string, addonIds: string[]): Promise<void> {
    const { error: delErr } = await supabase
      .from("item_addons")
      .delete()
      .eq("product_id", productId);
    if (!reportError("update the product's extras", delErr)) return;
    if (addonIds.length) {
      const { error } = await supabase.from("item_addons").insert(
        addonIds.map((addon_id, i) => ({
          product_id: productId,
          addon_id,
          sort_order: i,
        })),
      );
      reportError("update the product's extras", error);
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
    duplicateMenu,
    moveMenu,
    addSection,
    renameSection,
    deleteSection,
    moveSection,
    addProduct,
    updateProduct,
    deleteProduct,
    moveProduct,
    addAddon,
    updateAddon,
    deleteAddon,
    deleteItems,
    moveAddon,
    setAvailability,
    setProductAddons,
  };
}
