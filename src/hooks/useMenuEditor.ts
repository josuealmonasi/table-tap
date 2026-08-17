"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import type { MenuSchedule } from "@/lib/menu-schedule";
import { useT } from "@/lib/i18n/context";
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
  /** % off the base price (0 = full price). */
  discount_pct: number;
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

  /** Reports a failed write to the user. Used by every mutation below. */
  /**
   * `key` names the action in the user's language. The raw Supabase message is
   * logged rather than shown: it is English, it leaks schema details, and it
   * tells a restaurant owner nothing they can act on.
   */
  function reportError(key: string, error: { message: string } | null): boolean {
    if (error) {
      console.error(`${key}:`, error.message);
      toast(t(key), "error");
    }
    return !error;
  }

  /**
   * Runs a write, reports it either way, then refreshes local state.
   *
   * `done` is the confirmation. Every create, rename, edit and delete says so
   * — the rule for the whole dashboard, decided here because this is the one
   * place all of them pass through. Reordering and availability switches are
   * the exception: the row moves, or the switch flips, in front of the person
   * who pressed it, and a toast on top of that is noise.
   */
  async function run(
    key: string,
    write: PromiseLike<{ error: { message: string } | null }>,
    done?: string,
  ): Promise<void> {
    const { error } = await write;
    if (reportError(key, error) && done) toast(t(done));
    await reload();
  }

  /** Inserts a row, reports any failure, refreshes, and returns the new row's id. */
  async function insertReturningId(
    key: string,
    table: ReorderTable,
    row: Record<string, unknown>,
    done?: string,
  ): Promise<string | undefined> {
    const { data, error } = await supabase.from(table).insert(row).select("id").single();
    if (!reportError(key, error)) return undefined;
    if (done) toast(t(done));
    await reload();
    return (data as { id: string } | null)?.id;
  }

  /** Moves a row one step among its siblings, reporting any failure. */
  async function move(
    key: string,
    table: ReorderTable,
    siblings: Reorderable[],
    id: string,
    direction: "up" | "down",
  ): Promise<void> {
    reportError(key, await reorderRows(supabase, table, siblings, id, direction));
    await reload();
  }

  // ── Menus ──
  const addMenu = (name: string) =>
    insertReturningId("write.createMenu", "menus", {
      restaurant_id: restaurantId,
      name,
      active: true,
      sort_order: menus.length,
    });
  const renameMenu = (id: string, name: string) =>
    run("write.renameMenu", supabase.from("menus").update({ name }).eq("id", id));
  // Cascade deletes the menu's categories, products, extras and their links.
  const deleteMenu = (id: string) =>
    run("write.deleteMenu", supabase.from("menus").delete().eq("id", id), "done.menuDeleted");
  const moveMenu = (id: string, direction: "up" | "down") =>
    move("write.reorderMenus", "menus", menus, id, direction);

  /**
   * Opening hours for one menu. Null clears them, which returns the menu to
   * being driven by its switch alone.
   */
  async function setMenuSchedule(
    id: string,
    schedule: MenuSchedule | null,
  ): Promise<void> {
    const prev = menus;
    setMenus(m => m.map(x => (x.id === id ? { ...x, schedule } : x)));
    const { error } = await supabase.from("menus").update({ schedule }).eq("id", id);
    if (error) {
      setMenus(prev);
      reportError("write.updateMenu", error);
    }
  }

  async function setMenuActive(id: string, active: boolean): Promise<void> {
    const prev = menus;
    setMenus(m => m.map(x => (x.id === id ? { ...x, active } : x)));
    const { error } = await supabase.from("menus").update({ active }).eq("id", id);
    if (error) {
      setMenus(prev); // roll back the optimistic flip
      reportError("write.updateMenu", error);
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
    toast(t("done.menuDuplicatedAs", { name: result.copyName }));
    return result.newMenuId;
  }

  // ── Sections (categories) ──
  const addSection = (menuId: string, name: string) =>
    insertReturningId("write.createSection", "categories", {
      restaurant_id: restaurantId,
      menu_id: menuId,
      name,
      sort_order: sections.filter(s => s.menu_id === menuId).length,
    });
  const renameSection = (id: string, name: string) =>
    run(
      "write.renameSection",
      supabase.from("categories").update({ name }).eq("id", id),
      "done.sectionRenamed",
    );
  // Products in a deleted section keep existing (category_id → null via FK).
  const deleteSection = (id: string) =>
    run(
      "write.deleteSection",
      supabase.from("categories").delete().eq("id", id),
      "done.sectionDeleted",
    );

  async function moveSection(id: string, direction: "up" | "down"): Promise<void> {
    const section = sections.find(s => s.id === id);
    if (!section) return;
    const siblings = sections.filter(s => s.menu_id === section.menu_id);
    await move("write.reorderSections", "categories", siblings, id, direction);
  }

  // ── Products ──
  const addProduct = (menuId: string, categoryId: string | null, input: ProductInput) =>
    insertReturningId("write.createProduct", "menu_items", {
      restaurant_id: restaurantId,
      menu_id: menuId,
      category_id: categoryId,
      is_addon: false,
      sort_order: products.filter(p => p.menu_id === menuId).length,
      ...input,
    }, "done.productAdded");
  const updateProduct = (
    id: string,
    input: Partial<ProductInput & { category_id: string | null }>,
  ) => run(
      "write.updateProduct",
      supabase.from("menu_items").update(input).eq("id", id),
      "done.productUpdated",
    );
  const deleteProduct = (id: string) =>
    run(
      "write.deleteProduct",
      supabase.from("menu_items").delete().eq("id", id),
      "done.productDeleted",
    );

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
      "write.reorderProducts",
      "menu_items",
      products.filter(inSameGroup),
      id,
      direction,
    );
  }

  // ── Add-on items ──
  const addAddon = (menuId: string, input: AddonInput) =>
    run(
      "write.createExtra",
      supabase.from("menu_items").insert({
        restaurant_id: restaurantId,
        menu_id: menuId,
        category_id: null,
        is_addon: true,
        sort_order: addons.filter(a => a.menu_id === menuId).length,
        ...input,
      }),
      "done.extraAdded",
    );
  const updateAddon = (id: string, input: Partial<AddonInput>) =>
    run(
      "write.updateExtra",
      supabase.from("menu_items").update(input).eq("id", id),
      "done.extraUpdated",
    );
  const deleteAddon = (id: string) =>
    run(
      "write.deleteExtra",
      supabase.from("menu_items").delete().eq("id", id),
      "done.extraDeleted",
    );

  /** Bulk delete: removes any mix of products and extras in one call. */
  const deleteItems = (ids: string[]) =>
    run("write.deleteSelected", supabase.from("menu_items").delete().in("id", ids));

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
      reportError("write.updateAvailability", error);
    }
  }

  // ── Which add-ons a product offers (replace the full set) ──
  async function setProductAddons(productId: string, addonIds: string[]): Promise<void> {
    const { error: delErr } = await supabase
      .from("item_addons")
      .delete()
      .eq("product_id", productId);
    if (!reportError("write.updateProductExtras", delErr)) return;
    if (addonIds.length) {
      const { error } = await supabase.from("item_addons").insert(
        addonIds.map((addon_id, i) => ({
          product_id: productId,
          addon_id,
          sort_order: i,
        })),
      );
      reportError("write.updateProductExtras", error);
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
    setMenuSchedule,
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
