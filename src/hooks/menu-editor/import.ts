import { sameSection, sectionsOf, type ImportRow } from "@/lib/menu-import";
import type { EditorContext } from "./types";
import { writeError } from "@/lib/write-result";

/**
 * A menu brought in from a spreadsheet: the sections it names that the menu
 * does not have yet, then every product, in one write.
 *
 * One insert for all the products, so the plan's ceiling — which a trigger
 * checks row by row — refuses the whole import or none of it; a menu half
 * brought in is worse than one not brought in at all. If the products are
 * refused, the sections made for them are taken back.
 */
export function importActions(ctx: EditorContext) {
  const { supabase, restaurantId, reload } = ctx;
  const { reportError } = ctx.w;

  /** Writes the rows into a menu; returns how many products were added. */
  async function importRows(menuId: string, rows: ImportRow[]): Promise<number> {
    if (!(await ctx.ready())) return 0;
    if (rows.length === 0) return 0;
    // The sections the read just returned: one added in that read is matched,
    // not created a second time.
    const { sections, products } = ctx.latest.current;
    const inMenu = sections.filter(s => s.menu_id === menuId);
    const missing = sectionsOf(rows).filter(name => !inMenu.some(s => sameSection(s.name, name)));
    let made: { id: string; name: string }[] = [];
    if (missing.length) {
      const { data, error } = await supabase
        .from("categories")
        .insert(missing.map((name, i) => ({ restaurant_id: restaurantId, menu_id: menuId, name, sort_order: inMenu.length + i })))
        .select("id, name");
      if (!reportError("write.importMenu", writeError({ data, error }, missing.length))) return 0;
      made = (data ?? []) as { id: string; name: string }[];
    }
    const all = [...inMenu, ...made];
    const sectionOf = (name: string | null) => (name ? all.find(s => sameSection(s.name, name))?.id ?? null : null);
    const start = products.filter(p => p.menu_id === menuId).length;

    const result = await supabase.from("menu_items").insert(
      rows.map((row, i) => ({
        restaurant_id: restaurantId,
        menu_id: menuId,
        category_id: sectionOf(row.category),
        is_addon: false,
        sort_order: start + i,
        name: row.name,
        price: row.price,
        description: row.description,
        emoji: row.emoji,
      })),
      { count: "exact" },
    ).select("id");
    const error = writeError(result, rows.length);
    if (error) {
      if (made.length) await supabase.from("categories").delete().in("id", made.map(s => s.id));
      reportError("write.importMenu", error);
      await reload();
      return 0;
    }
    await reload();
    return rows.length;
  }

  return { importRows };
}
