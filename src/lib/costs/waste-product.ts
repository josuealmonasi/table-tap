import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow, everyRowIn } from "@/lib/paged";
import { verifyModifiers } from "@/lib/modifiers";
import type { Modifier, OrderExtra } from "@/lib/types";
import { uuidOf } from "./guard";
import { lineCost, recipeBook, unitCosts, type Choices, type RecipeLine } from "./recipe-cost";
import { recipeChoicesOffered } from "./recipe-choices";

export interface WasteProduct {
  choices: { mods: Choices; extras: OrderExtra[] };
  cost: number | null;
}
interface Product { id: string; name: string; emoji: string; price: number; modifiers: Modifier[] }

/** What it cost to throw away, at today's prices; null for a dish with no recipe.
 * Waste needs the plate that was made, including its choices and linked extras. */
export async function wasteProduct(restaurant: string, item: string, quantity: number, mods: unknown, extras: unknown): Promise<
  { value: WasteProduct } | { refusal: "missing" | "choices" }
> {
  const db = createAdminClient();
  const { data: product, error } = await db.from("menu_items").select("id, name, emoji, price, modifiers")
    .eq("id", item).eq("restaurant_id", restaurant).eq("is_addon", false).maybeSingle();
  if (error) throw new Error("Could not read the wasted product");
  if (!product) return { refusal: "missing" };
  const verified = verifyModifiers(product.modifiers ?? [], mods);
  const requested = extras ?? [];
  if (!verified.ok || !Array.isArray(requested) || requested.some(id => !uuidOf(id))) return { refusal: "choices" };
  const ids = requested as string[];
  if (ids.length > 100 || new Set(ids).size !== ids.length) return { refusal: "choices" };
  const links = await everyRow<{ addon_id: string }>((a, b) => db.from("item_addons").select("addon_id")
    .eq("product_id", item).order("addon_id").range(a, b), "the product's extras");
  if (ids.some(id => !links.some(link => link.addon_id === id))) return { refusal: "choices" };
  const addons = await everyRowIn<Product>(ids, (slice, a, b) => db.from("menu_items").select("id, name, emoji, price, modifiers")
    .eq("restaurant_id", restaurant).eq("is_addon", true).in("id", slice).order("id").range(a, b), "the wasted extras");
  if (ids.some(id => !addons.some(addon => addon.id === id))) return { refusal: "choices" };
  const lines = await everyRowIn<RecipeLine>([item, ...ids], (slice, a, b) => db.from("recipe_lines")
    .select("item_id, ingredient_id, quantity, mod_label, mod_option")
    .eq("restaurant_id", restaurant).in("item_id", slice).order("id").range(a, b), "the wasted recipes");
  const ingredients = await everyRowIn<{ id: string; unit_cost: number }>(lines.map(l => l.ingredient_id), (slice, a, b) => db.from("ingredients")
    .select("id, unit_cost").eq("restaurant_id", restaurant).in("id", slice).order("id").range(a, b), "the wasted ingredients");
  const choices = { mods: verified.mods, extras: addons.map(a => ({ id: a.id, name: a.name, emoji: a.emoji, price: Number(a.price) })) };
  const result = lineCost({ itemId: item, name: product.name, emoji: product.emoji, price: Number(product.price), qty: quantity, ...choices }, recipeBook(lines), unitCosts(ingredients));
  const offered = [product, ...addons].every(p => recipeChoicesOffered(lines.filter(l => l.item_id === p.id), p.modifiers ?? []));
  const known = lines.every(l => ingredients.some(i => i.id === l.ingredient_id && Number.isFinite(Number(i.unit_cost))));
  return { value: { choices, cost: result.complete && offered && known ? Math.round(result.cost * 100) / 100 : null } };
}
