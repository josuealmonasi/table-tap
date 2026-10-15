import type { Ingredient, RecipeBook, UnitCosts } from "./recipe-cost";
import { unitMargin, type CostedItem } from "./margins";

/**
 * A supplier's rise, and what it did to each product made with it.
 *
 * Over a window, an ingredient's price is compared with what it cost before
 * the window's first change. A rise names every product with that ingredient
 * in its recipe and its unit margin before and after — so "milk went up"
 * becomes "the latte now leaves MX$4 less".
 *
 * Pure.
 */

export interface PriceChange {
  ingredient_id: string;
  previous_cost: number | null;
  unit_cost: number;
  created_at: string;
}

export interface AffectedProduct {
  itemId: string;
  name: string;
  emoji: string | null;
  marginBefore: number;
  marginAfter: number;
}

export interface PriceRise {
  ingredientId: string;
  name: string;
  unit: Ingredient["unit"];
  before: number;
  after: number;
  /** When the most recent change in the window was made. */
  at: string;
  products: AffectedProduct[];
}

/** Changes are read newest first or oldest first; either is fine. */
export function priceRises(
  changes: PriceChange[],
  ingredients: Ingredient[],
  items: CostedItem[],
  book: RecipeBook,
  costs: UnitCosts,
  feeRate: number,
  taxPct: number,
): PriceRise[] {
  const ordered = [...changes].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const first = new Map<string, PriceChange>();
  const last = new Map<string, PriceChange>();
  for (const c of ordered) {
    if (c.previous_cost === null) continue; // the price it was created with is not a change
    if (!first.has(c.ingredient_id)) first.set(c.ingredient_id, c);
    last.set(c.ingredient_id, c);
  }

  const rises: PriceRise[] = [];
  for (const ingredient of ingredients) {
    const start = first.get(ingredient.id);
    if (!start) continue;
    const before = Number(start.previous_cost);
    const after = Number(ingredient.unit_cost);
    if (!(after > before)) continue;

    const then: UnitCosts = new Map(costs);
    then.set(ingredient.id, before);
    const products: AffectedProduct[] = [];
    for (const item of items) {
      if (!book.get(item.id)?.some(l => l.ingredient_id === ingredient.id)) continue;
      const now = unitMargin(item, book, costs, feeRate, taxPct);
      const was = unitMargin(item, book, then, feeRate, taxPct);
      // A product that uses it only on a choice its default does not make
      // (oat milk, on a latte made with whole milk) is not moved by it.
      if (now.margin === null || was.margin === null || was.margin - now.margin < 0.005) continue;
      products.push({ itemId: item.id, name: item.name, emoji: item.emoji, marginBefore: was.margin, marginAfter: now.margin });
    }
    products.sort((a, b) => (a.marginAfter - a.marginBefore) - (b.marginAfter - b.marginBefore));
    rises.push({
      ingredientId: ingredient.id, name: ingredient.name, unit: ingredient.unit,
      before, after, at: last.get(ingredient.id)!.created_at, products,
    });
  }
  return rises.sort((a, b) => b.at.localeCompare(a.at));
}
