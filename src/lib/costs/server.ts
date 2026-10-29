import { createAdminClient } from "@/lib/supabase/admin";
import { withReturnComponents } from "@/lib/return-components";
import { feesKeptSince } from "@/lib/report-fees";
import { everyRow } from "@/lib/paged";
import type { Modifier } from "@/lib/types";
import { recipeBook, unitCosts, type Ingredient, type RecipeLine } from "./recipe-cost";
import { feeRate, type FeePayment, type FeeRate } from "./fees";
import { periodContribution, unitMargins, type CostedItem, type PeriodContribution, type SoldOrder, type UnitMargin } from "./margins";
import { priceRises, type PriceChange, type PriceRise } from "./price-rises";

/** The window margins, fees and rises are read over. */
export const COST_WINDOW_DAYS = 30;

export interface CostedProduct extends CostedItem {
  menuName: string | null;
}

export interface CostsView {
  ingredients: Ingredient[];
  recipes: RecipeLine[];
  products: CostedProduct[];
  margins: UnitMargin[];
  period: PeriodContribution;
  fees: FeeRate;
  unverifiedFees: number;
  rises: PriceRise[];
  terminalFeePct: number;
  taxPct: number;
}

/**
 * Everything the costs screen shows, for one restaurant. Read with the secret
 * key — these are the restaurant's private books and no browser reads them —
 * and every read scoped to the restaurant, which is the only thing standing
 * between two tenants once RLS is out of the way.
 */
export async function readCosts(restaurantId: string, now = new Date()): Promise<CostsView> {
  const db = createAdminClient();
  const since = new Date(now.getTime() - COST_WINDOW_DAYS * 86_400_000).toISOString();

  // Recovered foreign-currency receipts remain in their own books. Adding
  // them to current menu margins would treat pesos and dollars as equal.
  const restaurant = await db.from("restaurants").select("currency, tax_pct, terminal_fee_pct").eq("id", restaurantId).single();
  if (restaurant.error || !restaurant.data) throw new Error(`Could not read the restaurant: ${restaurant.error?.message}`);
  const [ingredients, recipes, items, menus, changes, orders, payments] = await Promise.all([
    everyRow<Ingredient>((a, b) => db.from("ingredients")
      .select("id, name, unit, pack_size, pack_price, unit_cost, supplier, lead_days")
      .eq("restaurant_id", restaurantId).is("archived_at", null).order("id").range(a, b), "the ingredients"),
    everyRow<RecipeLine>((a, b) => db.from("recipe_lines")
      .select("item_id, ingredient_id, quantity, mod_label, mod_option")
      .eq("restaurant_id", restaurantId).order("id").range(a, b), "the recipes"),
    everyRow<CostedItem & { menu_id: string | null }>((a, b) => db.from("menu_items")
      .select("id, name, emoji, price, discount_pct, modifiers, is_addon, menu_id")
      .eq("restaurant_id", restaurantId).order("id").range(a, b), "the products"),
    everyRow<{ id: string; name: string }>((a, b) => db.from("menus")
      .select("id, name").eq("restaurant_id", restaurantId).order("id").range(a, b), "the menus"),
    everyRow<PriceChange>((a, b) => db.from("ingredient_prices")
      .select("ingredient_id, previous_cost, unit_cost, created_at")
      .eq("restaurant_id", restaurantId).gte("created_at", since).order("id").range(a, b), "the price changes"),
    everyRow<SoldOrder & { id: string; currency: string }>((a, b) => db.from("orders")
      .select("id, currency, items, total, service_fee, tip, tax_pct")
      .eq("restaurant_id", restaurantId).eq("currency", restaurant.data.currency).eq("paid", true).neq("status", "cancelled")
      .gte("created_at", since).order("id").range(a, b), "the period's sales"),
    everyRow<FeePayment>((a, b) => db.from("payments")
      .select("amount, method, stripe_payment_intent")
      .eq("restaurant_id", restaurantId).eq("currency", restaurant.data.currency).gte("created_at", since).order("id").range(a, b), "the period's payments"),
  ]);

  const taxPct = Number(restaurant.data.tax_pct) || 0;
  const terminalFeePct = Number(restaurant.data.terminal_fee_pct);
  const menuName = new Map(menus.map(m => [m.id, m.name]));
  const products: CostedProduct[] = items.map(i => ({
    id: i.id, name: i.name, emoji: i.emoji, price: Number(i.price), discount_pct: Number(i.discount_pct) || 0,
    modifiers: (i.modifiers ?? []) as Modifier[], is_addon: i.is_addon,
    menuName: i.menu_id ? menuName.get(i.menu_id) ?? null : null,
  }));
  const typed = ingredients.map(i => ({
    ...i, pack_size: Number(i.pack_size), pack_price: Number(i.pack_price), unit_cost: Number(i.unit_cost),
  }));
  const lines = recipes.map(l => ({ ...l, quantity: Number(l.quantity) }));
  const book = recipeBook(lines);
  const costs = unitCosts(typed);
  // What we kept, from the same ledger the month's ceiling reads: net of
  // whatever a refund gave back, on payments settled in the window.
  const platformFees = await feesKeptSince(restaurantId, since, restaurant.data.currency);
  const fees = feeRate(payments, platformFees.kept, terminalFeePct);

  return {
    ingredients: typed.sort((a, b) => a.name.localeCompare(b.name)),
    recipes: lines,
    products,
    margins: unitMargins(products, book, costs, fees.rate, taxPct),
    period: periodContribution(await withReturnComponents(db, restaurantId, orders), book, costs, fees.rate),
    fees,
    unverifiedFees: platformFees.unverified,
    rises: priceRises(changes, typed, products, book, costs, fees.rate, taxPct),
    terminalFeePct,
    taxPct,
  };
}
