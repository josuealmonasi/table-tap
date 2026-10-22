import type { AddonInput, EditorContext } from "./types";
import { writeError } from "@/lib/write-result";

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
    const addon = addons.find(a => a.id === id);
    if (!addon) return;
    const siblings = addons.filter(a => a.menu_id === addon.menu_id);
    await move("write.reorderExtras", "menu_items", siblings, id, direction);
  }

  // ── Availability toggle (products and add-ons) — optimistic, rolls back on failure ──
  async function setAvailability(id: string, available: boolean): Promise<void> {
    if (!(await ctx.ready())) return;
    const prevProducts = products;
    const prevAddons = addons;
    setProducts(prev => prev.map(p => (p.id === id ? { ...p, available } : p)));
    setAddons(prev => prev.map(a => (a.id === id ? { ...a, available } : a)));
    try {
      const error = writeError(await supabase
        .from("menu_items")
        .update({ available })
        .eq("id", id).select("id"));
      if (reportError("write.updateAvailability", error)) return;
    } catch {
      reportError("write.updateAvailability", { message: "Availability did not save" });
    }
    setProducts(prevProducts);
    setAddons(prevAddons);
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
    setAvailability,
    setProductAddons,
  };
}
