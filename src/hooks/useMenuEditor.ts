"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
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

type Reorderable = { id: string; sort_order: number };

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

  /** Reports a failed write to the user. Used by every mutation below. */
  function reportError(action: string, error: { message: string } | null) {
    if (error) toast(`Couldn't ${action}: ${error.message}`, "error");
    return !error;
  }

  // ── Menus ──
  async function addMenu(name: string): Promise<string | undefined> {
    const { data, error } = await supabase
      .from("menus")
      .insert({ restaurant_id: restaurantId, name, active: true, sort_order: menus.length })
      .select("id")
      .single();
    if (!reportError("create the menu", error)) return undefined;
    await reload();
    return (data as { id: string } | null)?.id;
  }
  async function renameMenu(id: string, name: string) {
    const { error } = await supabase.from("menus").update({ name }).eq("id", id);
    reportError("rename the menu", error);
    await reload();
  }
  async function deleteMenu(id: string) {
    // Cascade deletes the menu's categories, products, extras and their links.
    const { error } = await supabase.from("menus").delete().eq("id", id);
    reportError("delete the menu", error);
    await reload();
  }
  async function setMenuActive(id: string, active: boolean) {
    const prev = menus;
    setMenus((m) => m.map((x) => (x.id === id ? { ...x, active } : x)));
    const { error } = await supabase.from("menus").update({ active }).eq("id", id);
    if (error) {
      setMenus(prev); // roll back the optimistic flip
      reportError("update that menu", error);
    }
  }
  /** Deep-copies a menu: its sections, products, extras, and add-on links. Returns the new menu's id. */
  async function duplicateMenu(id: string): Promise<string | undefined> {
    const source = menus.find((m) => m.id === id);
    if (!source) return undefined;

    // Find a free "{name} copy" / "{name} copy 2" ... name.
    const existing = new Set(menus.map((m) => m.name.trim().toLowerCase()));
    let copyName = `${source.name} copy`;
    let n = 2;
    while (existing.has(copyName.toLowerCase())) copyName = `${source.name} copy ${n++}`;

    const { data: newMenuRow, error: menuErr } = await supabase
      .from("menus")
      .insert({ restaurant_id: restaurantId, name: copyName, active: source.active, sort_order: menus.length })
      .select("id")
      .single();
    if (!reportError("duplicate the menu", menuErr)) return undefined;
    const newMenuId = (newMenuRow as { id: string }).id;

    // Sections.
    const sourceSections = sections.filter((s) => s.menu_id === id);
    const sectionIdMap = new Map<string, string>();
    for (const s of sourceSections) {
      const { data, error } = await supabase
        .from("categories")
        .insert({ restaurant_id: restaurantId, menu_id: newMenuId, name: s.name, sort_order: s.sort_order })
        .select("id")
        .single();
      if (!reportError("duplicate a section", error)) return undefined;
      sectionIdMap.set(s.id, (data as { id: string }).id);
    }

    // Extras (add-ons) first, so products can reference them.
    const sourceAddons = addons.filter((a) => a.menu_id === id);
    const addonIdMap = new Map<string, string>();
    for (const a of sourceAddons) {
      const { data, error } = await supabase
        .from("menu_items")
        .insert({
          restaurant_id: restaurantId,
          menu_id: newMenuId,
          category_id: null,
          is_addon: true,
          name: a.name,
          price: a.price,
          emoji: a.emoji,
          available: a.available,
          sort_order: a.sort_order,
        })
        .select("id")
        .single();
      if (!reportError("duplicate an extra", error)) return undefined;
      addonIdMap.set(a.id, (data as { id: string }).id);
    }

    // Products, plus their add-on links.
    const sourceProducts = products.filter((p) => p.menu_id === id);
    for (const p of sourceProducts) {
      const { data, error } = await supabase
        .from("menu_items")
        .insert({
          restaurant_id: restaurantId,
          menu_id: newMenuId,
          category_id: p.category_id ? sectionIdMap.get(p.category_id) ?? null : null,
          is_addon: false,
          name: p.name,
          description: p.description,
          price: p.price,
          image_url: p.image_url,
          emoji: p.emoji,
          popular: p.popular,
          available: p.available,
          modifiers: p.modifiers,
          sort_order: p.sort_order,
        })
        .select("id")
        .single();
      if (!reportError("duplicate a product", error)) return undefined;
      const newProductId = (data as { id: string }).id;

      const linkedAddonIds = (links[p.id] ?? []).map((aid) => addonIdMap.get(aid)).filter(Boolean) as string[];
      if (linkedAddonIds.length) {
        const { error: linkErr } = await supabase
          .from("item_addons")
          .insert(linkedAddonIds.map((addon_id, i) => ({ product_id: newProductId, addon_id, sort_order: i })));
        reportError("link an extra to a duplicated product", linkErr);
      }
    }

    await reload();
    return newMenuId;
  }
  async function moveMenu(id: string, direction: "up" | "down") {
    await reorder("menus", menus, id, direction, "reorder menus");
    await reload();
  }

  // ── Sections (categories) ──
  async function addSection(menuId: string, name: string): Promise<string | undefined> {
    const { data, error } = await supabase
      .from("categories")
      .insert({
        restaurant_id: restaurantId,
        menu_id: menuId,
        name,
        sort_order: sections.filter((s) => s.menu_id === menuId).length,
      })
      .select("id")
      .single();
    if (!reportError("create the section", error)) return undefined;
    await reload();
    return (data as { id: string } | null)?.id;
  }
  async function renameSection(id: string, name: string) {
    const { error } = await supabase.from("categories").update({ name }).eq("id", id);
    reportError("rename the section", error);
    await reload();
  }
  async function deleteSection(id: string) {
    // Products in this section keep existing (category_id → null via FK).
    const { error } = await supabase.from("categories").delete().eq("id", id);
    reportError("delete the section", error);
    await reload();
  }
  async function moveSection(id: string, direction: "up" | "down") {
    const section = sections.find((s) => s.id === id);
    if (!section) return;
    const siblings = sections.filter((s) => s.menu_id === section.menu_id);
    await reorder("categories", siblings, id, direction, "reorder sections");
    await reload();
  }

  // ── Products ──
  async function addProduct(
    menuId: string,
    categoryId: string | null,
    input: ProductInput
  ): Promise<string | undefined> {
    const { data, error } = await supabase
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
    if (!reportError("create the product", error)) return undefined;
    await reload();
    return (data as { id: string } | null)?.id;
  }
  async function updateProduct(id: string, input: Partial<ProductInput & { category_id: string | null }>) {
    const { error } = await supabase.from("menu_items").update(input).eq("id", id);
    reportError("update the product", error);
    await reload();
  }
  async function deleteProduct(id: string) {
    const { error } = await supabase.from("menu_items").delete().eq("id", id);
    reportError("delete the product", error);
    await reload();
  }
  /** Moves a product up/down among its siblings (same menu + same section, including "uncategorized"). */
  async function moveProduct(id: string, direction: "up" | "down") {
    const product = products.find((p) => p.id === id);
    if (!product) return;
    const sectionIds = new Set(sections.map((s) => s.id));
    const inSameGroup = (p: MenuItem) =>
      p.menu_id === product.menu_id &&
      (product.category_id && sectionIds.has(product.category_id)
        ? p.category_id === product.category_id
        : !p.category_id || !sectionIds.has(p.category_id));
    const siblings = products.filter(inSameGroup);
    await reorder("menu_items", siblings, id, direction, "reorder products");
    await reload();
  }

  // ── Add-on items ──
  async function addAddon(menuId: string, input: AddonInput) {
    const { error } = await supabase.from("menu_items").insert({
      restaurant_id: restaurantId,
      menu_id: menuId,
      category_id: null,
      is_addon: true,
      sort_order: addons.filter((a) => a.menu_id === menuId).length,
      ...input,
    });
    reportError("create the extra", error);
    await reload();
  }
  async function updateAddon(id: string, input: Partial<AddonInput>) {
    const { error } = await supabase.from("menu_items").update(input).eq("id", id);
    reportError("update the extra", error);
    await reload();
  }
  async function deleteAddon(id: string) {
    const { error } = await supabase.from("menu_items").delete().eq("id", id);
    reportError("delete the extra", error);
    await reload();
  }
  async function moveAddon(id: string, direction: "up" | "down") {
    const addon = addons.find((a) => a.id === id);
    if (!addon) return;
    const siblings = addons.filter((a) => a.menu_id === addon.menu_id);
    await reorder("menu_items", siblings, id, direction, "reorder extras");
    await reload();
  }

  // ── Availability toggle (products and add-ons) — optimistic, rolls back on failure ──
  async function setAvailability(id: string, available: boolean) {
    const prevProducts = products;
    const prevAddons = addons;
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, available } : p)));
    setAddons((prev) => prev.map((a) => (a.id === id ? { ...a, available } : a)));
    const { error } = await supabase.from("menu_items").update({ available }).eq("id", id);
    if (error) {
      setProducts(prevProducts);
      setAddons(prevAddons);
      reportError("update availability", error);
    }
  }

  // ── Which add-ons a product offers (replace the full set) ──
  async function setProductAddons(productId: string, addonIds: string[]) {
    const { error: delErr } = await supabase.from("item_addons").delete().eq("product_id", productId);
    if (!reportError("update the product's extras", delErr)) return;
    if (addonIds.length) {
      const { error } = await supabase
        .from("item_addons")
        .insert(addonIds.map((addon_id, i) => ({ product_id: productId, addon_id, sort_order: i })));
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
    moveAddon,
    setAvailability,
    setProductAddons,
  };

  // Swaps sort_order between `id` and its up/down neighbor within `siblings`
  // (already-loaded rows, any order); writes both rows. No-op at either end.
  async function reorder(
    table: "menus" | "categories" | "menu_items",
    siblings: Reorderable[],
    id: string,
    direction: "up" | "down",
    action: string
  ) {
    const ordered = [...siblings].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((x) => x.id === id);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || swapIndex < 0 || swapIndex >= ordered.length) return;
    const a = ordered[index];
    const b = ordered[swapIndex];
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from(table).update({ sort_order: b.sort_order }).eq("id", a.id),
      supabase.from(table).update({ sort_order: a.sort_order }).eq("id", b.id),
    ]);
    reportError(action, e1 ?? e2);
  }
}
