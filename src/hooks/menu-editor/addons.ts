import type { AddonInput, EditorContext } from "./types";
import { setAvailability } from "./availability";

/** Extras, availability and which extras a product offers. */
export function addonActions(ctx: EditorContext) {
  const { supabase, restaurantId, addons, reload } =
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
      }).select("id"),
      "done.extraAdded",
    );
  const updateAddon = (id: string, input: Partial<AddonInput>) =>
    run(
      "write.updateExtra",
      supabase.from("menu_items").update(input).eq("id", id).select("id"),
      "done.extraUpdated",
    );
  const deleteAddon = (id: string) =>
    run(
      "write.deleteExtra",
      supabase.from("menu_items").delete().eq("id", id).select("id"),
      "done.extraDeleted",
    );

  /** Bulk delete: removes any mix of products and extras in one call. */
  const deleteItems = (ids: string[]) => ids.length ? run(
    "write.deleteSelected",
    supabase.from("menu_items").delete({ count: "exact" }).in("id", ids).select("id"),
    undefined,
    ids.length,
  ) : Promise.resolve(false);

  async function moveAddon(id: string, direction: "up" | "down"): Promise<void> {
    await move("write.reorderExtras", "menu_items", menu => {
      const addon = menu.addons.find(a => a.id === id);
      return addon ? menu.addons.filter(a => a.menu_id === addon.menu_id) : [];
    }, id, direction);
  }

  // ── Which add-ons a product offers (replace the full set) ──
  async function setProductAddons(productId: string, addonIds: string[]): Promise<void> {
    if (!(await ctx.ready())) throw new Error("Menu has not loaded");
    try {
      const res = await fetch("/api/products", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: productId, addonIds }),
      });
      if (!res.ok) throw new Error("Extras refused");
    } catch {
      reportError("write.updateProductExtras", { message: "Extras did not save" });
      throw new Error("Extras did not save");
    }
    await reload();
  }

  return {
    addAddon,
    updateAddon,
    deleteAddon,
    deleteItems,
    moveAddon,
    setAvailability: (id: string, available: boolean) => setAvailability(ctx, id, available),
    setProductAddons,
  };
}
