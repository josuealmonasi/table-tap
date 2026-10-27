import type { StockIngredient } from "@/lib/costs/stock-server";

/** Keep the ingredients that need a count ahead of ordinary shelf stock. */
export function stockCountOrder(ingredients: StockIngredient[], onHand: Record<string, number | null>): StockIngredient[] {
  const priority = (id: string) => onHand[id] == null || onHand[id] < 0 ? 0 : 1;
  return [...ingredients].sort((a, b) => priority(a.id) - priority(b.id) || a.name.localeCompare(b.name));
}

export function matchesIngredient(ingredient: StockIngredient, search: string): boolean {
  return ingredient.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
}
