import type { Ingredient } from "./recipe-cost";
import type { Usage } from "./usage";

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
  movement_cutoff?: number | string | null;
}

export interface IngredientMovement {
  id: number | string;
  ingredient_id: string;
  quantity: number;
  kind: "sale" | "waste" | "purchase";
  created_at: string;
}

/** Each ingredient's expected quantity now, or null for one never counted.
 * Counts made before the upgrade use their old date; new ones use a serial cutoff. */
export function expectedOnHand(
  ingredientIds: string[], lastCounts: Map<string, LastCount>, movements: IngredientMovement[],
): Map<string, number | null> {
  const expected = new Map(ingredientIds.map(id => [id, lastCounts.has(id) ? Number(lastCounts.get(id)!.counted) : null]));
  // Only what happened after the ingredient was counted moves it.
  for (const m of movements) {
    const count = lastCounts.get(m.ingredient_id);
    const current = expected.get(m.ingredient_id);
    const after = count && (count.movement_cutoff == null ? m.created_at > count.created_at : BigInt(m.id) > BigInt(count.movement_cutoff));
    if (after && current != null) expected.set(m.ingredient_id, current + Number(m.quantity));
  }
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
