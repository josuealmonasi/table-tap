import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import type { Ingredient } from "./recipe-cost";
import { WASTE_REASONS, type WasteEntry, type WasteReason } from "./usage";
import { expectedOnHand, purchaseList, type IngredientMovement, type LastCount, type Suggestion } from "./stock";

/** How far back what a day takes is averaged. */
export const USE_WINDOW_DAYS = 14;
/** How far back waste and purchases are listed. */
export const BOOK_WINDOW_DAYS = 30;
export type StockIngredient = Ingredient & { lead_days: number };

export interface CountRecord extends LastCount {
  expected: number | null;
  counted_by: string;
}

export interface PurchaseRecord {
  id: string;
  ingredient_id: string;
  quantity: number;
  total: number;
  recorded_by: string;
  created_at: string;
}

export interface StockView {
  ingredients: StockIngredient[];
  /** What the shelf should hold now, per ingredient id; null when never counted. */
  onHand: Record<string, number | null>;
  lastCounts: Record<string, CountRecord>;
  suggestions: Suggestion[];
  coverDays: number;
  waste: WasteEntry[];
  wasteByReason: Record<WasteReason, number>;
  purchases: PurchaseRecord[];
}

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

/**
 * Everything the waste, stock and purchases tabs show, for one restaurant.
 * Read with the secret key and scoped to the restaurant on every read; what
 * the shelf should hold is worked out from each ingredient's last count, so
 * the reads reach back to the oldest of those. Movements include every dish
 * made, whether or not it has been paid for.
 */
export async function readStock(restaurantId: string, now = new Date()): Promise<StockView> {
  const db = createAdminClient();
  const scoped = <T>(table: string, columns: string, what: string, since?: string, order = "id") =>
    everyRow<T>((a, b) => {
      let q = db.from(table).select(columns).eq("restaurant_id", restaurantId);
      if (since) q = q.gte("created_at", since);
      return q.order(order, { ascending: order === "id" }).order("id").range(a, b) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
    }, what);

  const [restaurant, ingredients, counts] = await Promise.all([
    db.from("restaurants").select("purchase_cover_days").eq("id", restaurantId).single(),
    everyRow<StockIngredient>((a, b) => db.from("ingredients")
      .select("id, name, unit, pack_size, pack_price, unit_cost, supplier, lead_days")
      .eq("restaurant_id", restaurantId).is("archived_at", null).order("id").range(a, b), "the ingredients"),
    everyRow<CountRecord>((a, b) => db.from("ingredient_counts")
      .select("ingredient_id, counted, expected, counted_by, created_at, movement_cutoff")
      .eq("restaurant_id", restaurantId).order("movement_cutoff", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }).order("id", { ascending: false }).range(a, b), "the counts"),
  ]);
  if (restaurant.error || !restaurant.data) throw new Error(`Could not read the restaurant: ${restaurant.error?.message}`);

  // Newest first, so the first seen for each ingredient is its last count.
  const lastCounts = new Map<string, CountRecord>();
  for (const c of counts) if (!lastCounts.has(c.ingredient_id)) lastCounts.set(c.ingredient_id, { ...c, counted: Number(c.counted) });
  const oldestCount = [...lastCounts.values()].map(c => c.created_at).sort()[0];
  const since = [oldestCount, daysAgo(now, BOOK_WINDOW_DAYS)].filter(Boolean).sort()[0];

  const cutoffs = [...lastCounts.values()].map(c => BigInt(c.movement_cutoff ?? 0));
  const oldestCutoff = cutoffs.reduce<bigint | null>((min, c) => min === null || c < min ? c : min, null);
  const [purchases, waste, movements] = await Promise.all([
    scoped<PurchaseRecord>("ingredient_purchases", "id, ingredient_id, quantity, total, recorded_by, created_at", "the purchases", since),
    scoped<WasteEntry>("waste_entries", "id, ingredient_id, item_id, name, quantity, reason, note, cost, recorded_by, created_at", "the waste", since),
    everyRow<IngredientMovement>((a, b) => {
      let q = db.from("ingredient_movements").select("id, ingredient_id, quantity, kind, created_at").eq("restaurant_id", restaurantId);
      // An older transaction can commit after a count. Its serial id, rather
      // than its start time, decides which side of the count it belongs to.
      q = oldestCutoff === null ? q.gte("created_at", since) : q.or(`id.gt.${oldestCutoff},created_at.gte.${since}`);
      return q.order("id").range(a, b);
    }, "the ingredient movements"),
  ]);

  const typed = ingredients.map(i => ({
    ...i, pack_size: Number(i.pack_size), pack_price: Number(i.pack_price), unit_cost: Number(i.unit_cost), lead_days: Number(i.lead_days),
  }));
  const expected = expectedOnHand(typed.map(i => i.id), lastCounts, movements);

  const recentSince = daysAgo(now, USE_WINDOW_DAYS);
  const recent = new Map<string, number>();
  for (const m of movements) if (m.kind !== "purchase" && m.created_at >= recentSince) {
    recent.set(m.ingredient_id, (recent.get(m.ingredient_id) ?? 0) - Number(m.quantity));
  }
  const coverDays = Number(restaurant.data.purchase_cover_days) || 7;

  const bookSince = daysAgo(now, BOOK_WINDOW_DAYS);
  const listed = waste.filter(w => w.created_at >= bookSince).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const wasteByReason = Object.fromEntries(WASTE_REASONS.map(r => [r, 0])) as Record<WasteReason, number>;
  for (const w of listed) wasteByReason[w.reason] += Number(w.cost ?? 0);

  return {
    ingredients: typed.sort((a, b) => a.name.localeCompare(b.name)),
    onHand: Object.fromEntries(expected),
    lastCounts: Object.fromEntries(lastCounts),
    suggestions: purchaseList(typed, expected, recent, USE_WINDOW_DAYS, coverDays),
    coverDays,
    waste: listed.slice(0, 100).map(w => ({ ...w, quantity: Number(w.quantity), cost: w.cost === null ? null : Number(w.cost) })),
    wasteByReason,
    purchases: purchases.filter(p => p.created_at >= bookSince).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50)
      .map(p => ({ ...p, quantity: Number(p.quantity), total: Number(p.total) })),
  };
}
