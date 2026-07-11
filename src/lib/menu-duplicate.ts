import type { createClient } from "@/lib/supabase/client";
import type { Category, Menu, MenuItem } from "@/lib/types";

type Supabase = ReturnType<typeof createClient>;

/** Everything duplicateMenuDeep needs from the editor's loaded state. */
export interface DuplicateMenuArgs {
  restaurantId: string;
  /** Id of the menu to copy. */
  sourceId: string;
  menus: Menu[];
  sections: Category[];
  products: MenuItem[];
  addons: MenuItem[];
  /** product_id → addon_id[] */
  links: Record<string, string[]>;
  /** Surfaces a failed write to the user; returns false when there was an error. */
  reportError: (action: string, error: { message: string } | null) => boolean;
}

export interface DuplicateMenuResult {
  newMenuId: string;
  copyName: string;
}

/**
 * Deep-copies a menu: its sections, products, extras, and product↔add-on
 * links, remapping every foreign key onto the freshly inserted rows. Returns
 * the new menu's id and name, or undefined if any write failed (the failure
 * is reported via reportError).
 */
export async function duplicateMenuDeep(
  supabase: Supabase,
  args: DuplicateMenuArgs,
): Promise<DuplicateMenuResult | undefined> {
  const {
    restaurantId,
    sourceId,
    menus,
    sections,
    products,
    addons,
    links,
    reportError,
  } = args;
  const source = menus.find(m => m.id === sourceId);
  if (!source) return undefined;

  // Find a free "{name} copy" / "{name} copy 2" ... name.
  const existing = new Set(menus.map(m => m.name.trim().toLowerCase()));
  let copyName = `${source.name} copy`;
  let n = 2;
  while (existing.has(copyName.toLowerCase())) copyName = `${source.name} copy ${n++}`;

  const { data: newMenuRow, error: menuErr } = await supabase
    .from("menus")
    .insert({
      restaurant_id: restaurantId,
      name: copyName,
      active: source.active,
      sort_order: menus.length,
    })
    .select("id")
    .single();
  if (!reportError("duplicate the menu", menuErr)) return undefined;
  const newMenuId = (newMenuRow as { id: string }).id;

  // Sections.
  const sectionIdMap = new Map<string, string>();
  for (const s of sections.filter(x => x.menu_id === sourceId)) {
    const { data, error } = await supabase
      .from("categories")
      .insert({
        restaurant_id: restaurantId,
        menu_id: newMenuId,
        name: s.name,
        sort_order: s.sort_order,
      })
      .select("id")
      .single();
    if (!reportError("duplicate a section", error)) return undefined;
    sectionIdMap.set(s.id, (data as { id: string }).id);
  }

  // Extras (add-ons) first, so products can reference them.
  const addonIdMap = new Map<string, string>();
  for (const a of addons.filter(x => x.menu_id === sourceId)) {
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
  for (const p of products.filter(x => x.menu_id === sourceId)) {
    const { data, error } = await supabase
      .from("menu_items")
      .insert({
        restaurant_id: restaurantId,
        menu_id: newMenuId,
        category_id: p.category_id ? (sectionIdMap.get(p.category_id) ?? null) : null,
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

    const linkedAddonIds = (links[p.id] ?? [])
      .map(aid => addonIdMap.get(aid))
      .filter(Boolean) as string[];
    if (linkedAddonIds.length) {
      const { error: linkErr } = await supabase.from("item_addons").insert(
        linkedAddonIds.map((addon_id, i) => ({
          product_id: newProductId,
          addon_id,
          sort_order: i,
        })),
      );
      reportError("link an extra to a duplicated product", linkErr);
    }
  }

  return { newMenuId, copyName };
}
