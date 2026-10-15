import type { Modifier, OrderLineItem } from "@/lib/types";
import type { IngredientUnit } from "./input";

/**
 * What a product costs to make, from its recipe and what each ingredient
 * costs now.
 *
 * A recipe line with a choice applies only when that choice was made: the
 * oat milk belongs to "Leche: Avena". A sold line costs its dish (or, for a
 * combo, each dish inside it), every extra on it, times how many.
 *
 * Pure.
 */

export interface Ingredient {
  id: string;
  name: string;
  unit: IngredientUnit;
  pack_size: number;
  pack_price: number;
  unit_cost: number;
  supplier: string | null;
}

export interface RecipeLine {
  item_id: string;
  ingredient_id: string;
  quantity: number;
  mod_label: string | null;
  mod_option: string | null;
}

/** Each product's recipe lines, by product id. */
export type RecipeBook = Map<string, RecipeLine[]>;
/** What one unit of each ingredient costs, by ingredient id. */
export type UnitCosts = Map<string, number>;
/** The choices on a line, as orders keep them: label to option, or options. */
export type Choices = Record<string, string | string[]>;

export function recipeBook(lines: RecipeLine[]): RecipeBook {
  const book: RecipeBook = new Map();
  for (const line of lines) {
    const list = book.get(line.item_id);
    if (list) list.push(line);
    else book.set(line.item_id, [line]);
  }
  return book;
}

export function unitCosts(ingredients: Pick<Ingredient, "id" | "unit_cost">[]): UnitCosts {
  return new Map(ingredients.map(i => [i.id, Number(i.unit_cost)]));
}

function chosen(choices: Choices, label: string, option: string): boolean {
  const picked = choices[label];
  return Array.isArray(picked) ? picked.includes(option) : picked === option;
}

/** One unit of a dish with these choices; null when it has no recipe at all. */
export function dishCost(itemId: string, choices: Choices, book: RecipeBook, costs: UnitCosts): number | null {
  const lines = book.get(itemId);
  if (!lines?.length) return null;
  let cost = 0;
  for (const line of lines) {
    if (line.mod_label !== null && line.mod_option !== null && !chosen(choices, line.mod_label, line.mod_option)) continue;
    cost += Number(line.quantity) * (costs.get(line.ingredient_id) ?? 0);
  }
  return cost;
}

/**
 * The choices a product is costed with when nobody has chosen yet: the first
 * option of every single choice, which is how a menu lists its default.
 */
export function defaultChoices(modifiers: Modifier[] | null | undefined): Choices {
  const choices: Choices = {};
  for (const m of modifiers ?? []) if (m.type === "single" && m.options.length) choices[m.label] = m.options[0];
  return choices;
}

export interface LineCost {
  /** What the whole line cost to make: every unit, its extras included. */
  cost: number;
  /** Every dish and extra on it has a recipe; otherwise `cost` is too low. */
  complete: boolean;
}

/** What a sold line cost to make. */
export function lineCost(line: OrderLineItem, book: RecipeBook, costs: UnitCosts): LineCost {
  let unit = 0;
  let complete = true;
  const add = (cost: number | null, times = 1) => {
    if (cost === null) complete = false;
    else unit += cost * times;
  };
  if (line.components?.length) {
    for (const c of line.components) add(dishCost(c.itemId, c.mods ?? {}, book, costs), c.qty);
  } else {
    add(dishCost(line.itemId, line.mods ?? {}, book, costs));
  }
  for (const extra of line.extras ?? []) add(dishCost(extra.id, {}, book, costs));
  return { cost: unit * line.qty, complete };
}
