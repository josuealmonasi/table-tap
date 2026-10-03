import type { AddonInput, EditorContext } from "./types";

/** Extras, availability and which extras a product offers. */
export function addonActions(ctx: EditorContext) {
  const { supabase, restaurantId, products, addons, setProducts, setAddons, reload } =
    ctx;
  const { reportError, run, move } = ctx.w;
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
    await move("write.reorderExtras", "menu_items", siblings, id, direction);
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
    addAddon,
    updateAddon,
    deleteAddon,
    deleteItems,
    moveAddon,
    setAvailability,
    setProductAddons,
  };
}
