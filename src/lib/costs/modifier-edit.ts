import type { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError } from "@/lib/api-error";
import { everyRow } from "@/lib/paged";
import type { Modifier } from "@/lib/types";
import type { RecipeLine } from "./recipe-cost";
import { recipeChoicesOffered } from "./recipe-choices";

/** Refuse before saving; the database repeats this check under the product lock. */
export async function modifierEditBlocks(restaurant: string, item: string, raw: unknown): Promise<NextResponse | null> {
  if (!Array.isArray(raw) || raw.some(m => !m || typeof m.label !== "string" ||
    !["single", "multi"].includes(m.type) || !Array.isArray(m.options) || m.options.some((o: unknown) => typeof o !== "string"))) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const db = createAdminClient();
  try {
    const lines = await everyRow<Pick<RecipeLine, "mod_label" | "mod_option">>((a, b) => db.from("recipe_lines").select("mod_label, mod_option")
      .eq("restaurant_id", restaurant).eq("item_id", item).order("id").range(a, b), "the recipe's choices");
    if (recipeChoicesOffered(lines, raw as Modifier[])) return null;
    const { data, error } = await db.from("menu_items").select("name").eq("restaurant_id", restaurant).eq("id", item).maybeSingle();
    if (error) return await apiError("apiErr.generic", 503);
    return await apiError("apiErr.recipeModifierEdit", 409, { name: data?.name ?? "" });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}
