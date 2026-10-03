import type { Category, MenuItem } from "@/lib/types";

export interface PosSection {
  name: string;
  dishes: MenuItem[];
}

/**
 * The till's menu, by section, narrowed to what the cashier typed.
 *
 * Grouped by the name on the heading, not by the row id. A restaurant with a
 * lunch menu and a dinner menu has a Starters in each, and listing "STARTERS"
 * twice tells a cashier nothing about which is which — they are the same
 * section of the same counter.
 *
 * Sold-out dishes stay on the till, unlike the diner's menu which hides them.
 * A cashier is standing in front of somebody who just asked for one, and "it
 * is not on my screen" is not an answer — "we've run out of that" is. Shown,
 * marked, and not orderable.
 */
export function posSections(
  categories: Category[],
  items: MenuItem[],
  search: string,
): PosSection[] {
  const sections = new Map<string, PosSection>();
  for (const category of categories) {
    const dishes = items.filter(i => i.category_id === category.id);
    if (dishes.length === 0) continue;
    const key = category.name.trim().toLowerCase();
    const existing = sections.get(key);
    if (existing) existing.dishes = [...existing.dishes, ...dishes];
    else sections.set(key, { name: category.name, dishes });
  }
  const needle = search.trim().toLowerCase();
  return [...sections.values()]
    .map(sec => ({
      ...sec,
      dishes: needle
        ? sec.dishes.filter(d => d.name.toLowerCase().includes(needle))
        : sec.dishes,
    }))
    .filter(sec => sec.dishes.length > 0);
}

/** A heading's own id, so a chip can jump to it and scrolling still works. */
export function posSectionId(name: string): string {
  return `pos-${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
}
