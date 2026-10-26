import type { MenuItem } from "@/lib/types";
import type { MenuSnapshot } from "./types";

/** A row can replace its old slot only while its structural membership agrees. */
export function patchSavedItem(menu: MenuSnapshot, row: MenuItem | undefined, restaurantId: string): MenuSnapshot | null {
  if (!row || row.restaurant_id !== restaurantId || typeof row.available !== "boolean" ||
      typeof row.is_addon !== "boolean" || typeof row.name !== "string" ||
      typeof row.price !== "number" || typeof row.sort_order !== "number") return null;
  const key = row.is_addon ? "addons" : "products";
  const old = menu[key].find(item => item.id === row.id);
  if (!old || old.restaurant_id !== restaurantId ||
      (["menu_id", "category_id", "sort_order"] as const).some(key => old[key] !== row[key])) return null;
  return { ...menu, [key]: menu[key].map(item => item.id === row.id ? row : item) };
}
