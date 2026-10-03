import type { MenuSchedule } from "@/lib/menu-schedule";
import { duplicateMenuDeep } from "@/lib/menu-duplicate";
import type { EditorContext } from "./types";

/** Menus and their sections: create, rename, delete, reorder, schedule, switch, copy. */
export function menuActions(ctx: EditorContext) {
  const {
    supabase,
    restaurantId,
    toast,
    t,
    menus,
    sections,
    products,
    addons,
    links,
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
    run("write.renameMenu", supabase.from("menus").update({ name }).eq("id", id));
  // Cascade deletes the menu's categories, products, extras and their links.
  const deleteMenu = (id: string) =>
    run(
      "write.deleteMenu",
      supabase.from("menus").delete().eq("id", id),
      "done.menuDeleted",
    );
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

  return {
    addMenu,
    renameMenu,
    deleteMenu,
    moveMenu,
    setMenuSchedule,
    setMenuActive,
    duplicateMenu,
    addSection,
    renameSection,
    deleteSection,
    moveSection,
  };
}
