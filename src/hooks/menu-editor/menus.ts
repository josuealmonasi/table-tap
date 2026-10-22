import type { MenuSchedule } from "@/lib/menu-schedule";
import { duplicateMenuDeep } from "@/lib/menu-duplicate";
import type { EditorContext } from "./types";
import { writeError } from "@/lib/write-result";

/** Menus and their sections: create, rename, delete, reorder, schedule, switch, copy. */
export function menuActions(ctx: EditorContext) {
  const {
    supabase,
    restaurantId,
    toast,
    t,
    menus,
    sections,
    setMenus,
    reload,
  } = ctx;
  const { reportError, run, insertReturningId, move } = ctx.w;
  // ── Menus ──
  const addMenu = (name: string) =>
    insertReturningId("write.createMenu", "menus", {
      restaurant_id: restaurantId,
      name,
      active: true,
      sort_order: menus.length,
    });
  const renameMenu = (id: string, name: string) =>
    run("write.renameMenu", supabase.from("menus").update({ name }).eq("id", id).select("id"));
  // Cascade deletes the menu's categories, products, extras and their links.
  const deleteMenu = (id: string) =>
    run(
      "write.deleteMenu",
      supabase.from("menus").delete().eq("id", id).select("id"),
      "done.menuDeleted",
    );
  const moveMenu = (id: string, direction: "up" | "down") =>
    move("write.reorderMenus", "menus", menu => menu.menus, id, direction);

  /**
   * Opening hours for one menu. Null clears them, which returns the menu to
   * being driven by its switch alone.
   */
  async function setMenuSchedule(
    id: string,
    schedule: MenuSchedule | null,
  ): Promise<boolean> {
    if (!(await ctx.ready())) return false;
    setMenus(m => m.map(x => (x.id === id ? { ...x, schedule } : x)));
    let saved = false;
    try {
      const error = writeError(await supabase.from("menus").update({ schedule }).eq("id", id).select("id"));
      saved = reportError("write.updateMenu", error);
    } catch {
      toast(t("write.updateMenu"), "error");
    }
    // Read back what is saved, whether it saved or not. A failure rolls back
    // that way, never by restoring the arrays this was called with: they are
    // the render before the read `ready` waited for (audit L, finding 7). A
    // success reads too, so the editor's latest read holds the new value (a
    // copy made next copied the old one) and a reload another switch's
    // failure started cannot leave this one showing what it was before. The
    // later read wins; the loader drops the earlier (cross-review of batch 5).
    await reload();
    return saved;
  }

  async function setMenuActive(id: string, active: boolean): Promise<void> {
    if (!(await ctx.ready())) return;
    setMenus(m => m.map(x => (x.id === id ? { ...x, active } : x)));
    try {
      const error = writeError(await supabase.from("menus").update({ active }).eq("id", id).select("id"));
      reportError("write.updateMenu", error);
    } catch {
      toast(t("write.updateMenu"), "error");
    }
    // Read back either way, as the availability switch does.
    await reload();
  }

  /** Deep-copies a menu: its sections, products, extras, and add-on links. Returns the new menu's id. */
  async function duplicateMenu(id: string): Promise<string | undefined> {
    // Only a fully loaded menu may be copied (J17); the copy itself is the
    // server's, in one transaction (J2/J14).
    if (!(await ctx.ready())) return undefined;
    const result = await duplicateMenuDeep({
      sourceId: id,
      reportError,
      onError: message => toast(message, "error"),
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
  /** Where a section's dishes are made; new orders carry it to the board. */
  const setSectionStation = (id: string, station: "kitchen" | "bar") =>
    run(
      "write.sectionStation",
      supabase.from("categories").update({ station }).eq("id", id).select("id"),
      "done.sectionStation",
    );
  const renameSection = (id: string, name: string) =>
    run(
      "write.renameSection",
      supabase.from("categories").update({ name }).eq("id", id).select("id"),
      "done.sectionRenamed",
    );
  // Products in a deleted section keep existing (category_id → null via FK).
  const deleteSection = (id: string) =>
    run(
      "write.deleteSection",
      supabase.from("categories").delete().eq("id", id).select("id"),
      "done.sectionDeleted",
    );

  async function moveSection(id: string, direction: "up" | "down"): Promise<void> {
    await move("write.reorderSections", "categories", menu => {
      const section = menu.sections.find(s => s.id === id);
      return section ? menu.sections.filter(s => s.menu_id === section.menu_id) : [];
    }, id, direction);
  }

  return {
    addMenu,
    renameMenu,
    deleteMenu,
    moveMenu,
    setMenuSchedule,
    setMenuActive,
    duplicateMenu,
    addSection,
    setSectionStation,
    renameSection,
    deleteSection,
    moveSection,
  };
}
