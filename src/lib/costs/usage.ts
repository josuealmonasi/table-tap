import type { Modifier, OrderLineItem } from "@/lib/types";
import { defaultChoices, type Choices, type RecipeBook } from "./recipe-cost";

/**
 * How much of each ingredient went out: in what was sold, and in what was
 * thrown away. A line takes what its recipe says, the choices made on it
 * included, times how many; a combo takes each dish inside it; an extra
 * takes its own recipe.
 *
 * Pure.
 */

/** Ingredient id to quantity, in the ingredient's own unit. */
export type Usage = Map<string, number>;

export type WasteReason = "spoiled" | "unsold" | "mistake" | "staff";
export const WASTE_REASONS: WasteReason[] = ["spoiled", "unsold", "mistake", "staff"];

export interface WasteEntry {
  id: string;
  ingredient_id: string | null;
  item_id: string | null;
  name: string;
  quantity: number;
  reason: WasteReason;
  note: string | null;
  cost: number | null;
  recorded_by: string;
  created_at: string;
}

function add(usage: Usage, ingredientId: string, quantity: number): void {
  usage.set(ingredientId, (usage.get(ingredientId) ?? 0) + quantity);
}

/** What `times` of a dish with these choices take. A dish with no recipe takes nothing we know of. */
export function addDish(usage: Usage, itemId: string, choices: Choices, times: number, book: RecipeBook): void {
  for (const line of book.get(itemId) ?? []) {
    if (line.mod_label !== null && line.mod_option !== null) {
      const picked = choices[line.mod_label];
      const made = Array.isArray(picked) ? picked.includes(line.mod_option) : picked === line.mod_option;
      if (!made) continue;
    }
    add(usage, line.ingredient_id, Number(line.quantity) * times);
  }
}

/** What one sold line took. */
export function addLine(usage: Usage, line: OrderLineItem, book: RecipeBook): void {
  if (line.components?.length) {
    for (const c of line.components) addDish(usage, c.itemId, c.mods ?? {}, c.qty * line.qty, book);
  } else {
    addDish(usage, line.itemId, line.mods ?? {}, line.qty, book);
  }
  for (const extra of line.extras ?? []) addDish(usage, extra.id, {}, line.qty, book);
}

/** What a list of orders took, all together. */
export function ordersUsage(orders: { items: OrderLineItem[] }[], book: RecipeBook, into: Usage = new Map()): Usage {
  for (const order of orders) for (const line of Array.isArray(order.items) ? order.items : []) addLine(into, line, book);
  return into;
}

/**
 * What waste took. An ingredient thrown away is itself; a dish thrown away
 * is its recipe, made the way the menu makes it by default.
 */
export function wasteUsage(
  entries: Pick<WasteEntry, "ingredient_id" | "item_id" | "quantity">[],
  book: RecipeBook,
  modifiersOf: (itemId: string) => Modifier[] | undefined,
  into: Usage = new Map(),
): Usage {
  for (const e of entries) {
    if (e.ingredient_id) add(into, e.ingredient_id, Number(e.quantity));
    else if (e.item_id) addDish(into, e.item_id, defaultChoices(modifiersOf(e.item_id)), Number(e.quantity), book);
  }
  return into;
}
