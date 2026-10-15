import type { Modifier, OrderLineItem } from "@/lib/types";
import type { Ingredient, RecipeBook } from "./recipe-cost";
import { addLine, wasteUsage, type Usage, type WasteEntry } from "./usage";

/**
 * What the shelf should hold, and what to buy before it runs out.
 *
 * An ingredient's last count is the truth on the day it was taken. Since
 * then, deliveries added to it, and orders and waste took from it — so the
 * shelf should hold the count, plus what came in, less what went out. Never
 * counted, there is nothing to start from, and the answer is unknown rather
 * than zero.
 *
 * Pure.
 */

export interface LastCount {
  ingredient_id: string;
  counted: number;
  created_at: string;
}

export interface Purchase {
  ingredient_id: string;
  quantity: number;
  created_at: string;
}

export interface MadeOrder {
  items: OrderLineItem[];
  created_at: string;
}

export type DatedWaste = Pick<WasteEntry, "ingredient_id" | "item_id" | "quantity" | "created_at">;

/** Each ingredient's expected quantity now, or null for one never counted. */
export function expectedOnHand(
  ingredientIds: string[],
  lastCounts: Map<string, LastCount>,
  purchases: Purchase[],
  orders: MadeOrder[],
  waste: DatedWaste[],
  book: RecipeBook,
  modifiersOf: (itemId: string) => Modifier[] | undefined,
): Map<string, number | null> {
  const expected = new Map<string, number | null>(
    ingredientIds.map(id => [id, lastCounts.has(id) ? Number(lastCounts.get(id)!.counted) : null]),
  );
  // Only what happened after the ingredient was counted moves it.
  const apply = (usage: Usage, at: string, sign: 1 | -1) => {
    for (const [id, quantity] of usage) {
      const count = lastCounts.get(id);
      const now = expected.get(id);
      if (count && now !== null && now !== undefined && at > count.created_at) expected.set(id, now + sign * quantity);
    }
  };
  for (const p of purchases) apply(new Map([[p.ingredient_id, Number(p.quantity)]]), p.created_at, 1);
  for (const o of orders) {
    const usage: Usage = new Map();
    for (const line of Array.isArray(o.items) ? o.items : []) addLine(usage, line, book);
    apply(usage, o.created_at, -1);
  }
  for (const w of waste) apply(wasteUsage([w], book, modifiersOf), w.created_at, -1);
  return expected;
}

export interface Suggestion {
  ingredientId: string;
  name: string;
  unit: Ingredient["unit"];
  supplier: string | null;
  /** What a day takes, from the recent window. */
  dailyUse: number;
  /** What the shelf should hold now; null when never counted. */
  onHand: number | null;
  packs: number;
  packSize: number;
  /** At today's pack price. */
  cost: number;
  /** It runs out before a delivery ordered today would arrive. */
  urgent: boolean;
}

/**
 * What to buy: enough of each ingredient to last until the supplier delivers
 * and then `coverDays` more, less what the shelf already holds, in whole
 * packs. An ingredient never counted is listed as if the shelf were empty,
 * and says so; one the recent window never used is left out.
 */
export function purchaseList(
  ingredients: (Ingredient & { lead_days: number })[],
  onHand: Map<string, number | null>,
  recentUse: Usage,
  windowDays: number,
  coverDays: number,
): Suggestion[] {
  const list: Suggestion[] = [];
  for (const i of ingredients) {
    const dailyUse = (recentUse.get(i.id) ?? 0) / windowDays;
    if (dailyUse <= 0) continue;
    const have = onHand.get(i.id) ?? null;
    const short = dailyUse * (i.lead_days + coverDays) - Math.max(0, have ?? 0);
    if (short <= 0) continue;
    const packs = Math.ceil(short / i.pack_size - 1e-9);
    list.push({
      ingredientId: i.id, name: i.name, unit: i.unit, supplier: i.supplier, dailyUse, onHand: have,
      packs, packSize: i.pack_size, cost: packs * i.pack_price,
      urgent: have !== null && have < dailyUse * i.lead_days,
    });
  }
  return list.sort((a, b) =>
    Number(b.urgent) - Number(a.urgent) || (a.supplier ?? "").localeCompare(b.supplier ?? "") || a.name.localeCompare(b.name));
}
