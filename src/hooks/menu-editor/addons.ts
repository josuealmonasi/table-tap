import type { AddonInput, EditorContext } from "./types";
import { writeError } from "@/lib/write-result";

/** Extras, availability and which extras a product offers. */
export function addonActions(ctx: EditorContext) {
  const { supabase, restaurantId, addons, setProducts, setAddons, reload } =
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

  // ── Availability toggle (products and add-ons) — optimistic, then read back ──
  async function setAvailability(id: string, available: boolean): Promise<void> {
    if (!(await ctx.ready())) return;
    setProducts(prev => prev.map(p => (p.id === id ? { ...p, available } : p)));
    setAddons(prev => prev.map(a => (a.id === id ? { ...a, available } : a)));
    try {
      const error = writeError(await supabase
        .from("menu_items")
        .update({ available })
        .eq("id", id).select("id"));
      reportError("write.updateAvailability", error);
    } catch {
      reportError("write.updateAvailability", { message: "Availability did not save" });
    }
    // Read back what is saved, whether it saved or not. A failure rolls back
    // that way, never by restoring the arrays this was called with: they are
    // the render before the read `ready` waited for (audit L, finding 7). A
    // success reads too, so the editor's latest read holds the new value (a
    // copy made next copied the old one) and a reload another switch's
    // failure started cannot leave this one showing what it was before. The
    // later read wins; the loader drops the earlier (cross-review of batch 5).
    await reload();
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
