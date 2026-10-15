import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import type { Modifier, OrderLineItem } from "@/lib/types";
import { recipeBook, type Ingredient, type RecipeLine } from "./recipe-cost";
import { ordersUsage, wasteUsage, WASTE_REASONS, type WasteEntry, type WasteReason } from "./usage";
import { expectedOnHand, purchaseList, type LastCount, type Purchase, type Suggestion } from "./stock";

/** How far back what a day takes is averaged. */
export const USE_WINDOW_DAYS = 14;
/** How far back waste and purchases are listed. */
export const BOOK_WINDOW_DAYS = 30;
/** The order states in which a dish was made — paid or not. */
const MADE = ["received", "preparing", "ready", "completed"];

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
 * the reads reach back to the oldest of those.
 */
export async function readStock(restaurantId: string, now = new Date()): Promise<StockView> {
  const db = createAdminClient();
  const scoped = <T>(table: string, columns: string, what: string, since?: string, order = "id") =>
    everyRow<T>((a, b) => {
      let q = db.from(table).select(columns).eq("restaurant_id", restaurantId);
      if (since) q = q.gte("created_at", since);
      return q.order(order, { ascending: order === "id" }).order("id").range(a, b) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
    }, what);

  const [restaurant, ingredients, recipes, items, counts] = await Promise.all([
    db.from("restaurants").select("purchase_cover_days").eq("id", restaurantId).single(),
    everyRow<StockIngredient>((a, b) => db.from("ingredients")
      .select("id, name, unit, pack_size, pack_price, unit_cost, supplier, lead_days")
      .eq("restaurant_id", restaurantId).is("archived_at", null).order("id").range(a, b), "the ingredients"),
    scoped<RecipeLine>("recipe_lines", "item_id, ingredient_id, quantity, mod_label, mod_option", "the recipes"),
    scoped<{ id: string; modifiers: Modifier[] }>("menu_items", "id, modifiers", "the products"),
    scoped<CountRecord>("ingredient_counts", "ingredient_id, counted, expected, counted_by, created_at", "the counts", undefined, "created_at"),
  ]);
  if (restaurant.error || !restaurant.data) throw new Error(`Could not read the restaurant: ${restaurant.error?.message}`);

  // Newest first, so the first seen for each ingredient is its last count.
  const lastCounts = new Map<string, CountRecord>();
  for (const c of counts) if (!lastCounts.has(c.ingredient_id)) lastCounts.set(c.ingredient_id, { ...c, counted: Number(c.counted) });
  const oldestCount = [...lastCounts.values()].map(c => c.created_at).sort()[0];
  const since = [oldestCount, daysAgo(now, BOOK_WINDOW_DAYS)].filter(Boolean).sort()[0];

  const [purchases, waste, orders] = await Promise.all([
    scoped<PurchaseRecord>("ingredient_purchases", "id, ingredient_id, quantity, total, recorded_by, created_at", "the purchases", since),
    scoped<WasteEntry>("waste_entries", "id, ingredient_id, item_id, name, quantity, reason, note, cost, recorded_by, created_at", "the waste", since),
    everyRow<{ items: OrderLineItem[]; created_at: string }>((a, b) => db.from("orders")
      .select("items, created_at").eq("restaurant_id", restaurantId).in("status", MADE)
      .gte("created_at", since).order("id").range(a, b), "the orders made"),
  ]);

  const book = recipeBook(recipes.map(l => ({ ...l, quantity: Number(l.quantity) })));
  const modifiers = new Map(items.map(i => [i.id, i.modifiers ?? []]));
  const modifiersOf = (id: string) => modifiers.get(id);
  const typed = ingredients.map(i => ({
    ...i, pack_size: Number(i.pack_size), pack_price: Number(i.pack_price), unit_cost: Number(i.unit_cost), lead_days: Number(i.lead_days),
  }));
  const expected = expectedOnHand(typed.map(i => i.id), lastCounts, purchases as Purchase[], orders, waste, book, modifiersOf);

  const recentSince = daysAgo(now, USE_WINDOW_DAYS);
  const recent = ordersUsage(orders.filter(o => o.created_at >= recentSince), book);
  wasteUsage(waste.filter(w => w.created_at >= recentSince), book, modifiersOf, recent);
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
