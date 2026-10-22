import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { actingManager } from "@/lib/api-guard";
import { costsBlocks, uuidOf } from "@/lib/costs/guard";
import { MAX_RECIPE_LINES, quantityRefusal, recipeQuantity } from "@/lib/costs/input";
import type { Modifier } from "@/lib/types";

export const runtime = "nodejs";

// PUT /api/costs/recipe — a product's recipe, replaced whole.
//
// { itemId, lines: [{ ingredientId, quantity, modLabel?, modOption? }] }
//
// A line with a choice applies only when the diner makes it, so the choice
// must be one the product offers: a line under a choice nobody can make is a
// cost that never counts. An empty list clears the recipe.

interface LineBody { ingredientId?: unknown; quantity?: unknown; modLabel?: unknown; modOption?: unknown }
interface CleanLine { ingredient_id: string; quantity: number; mod_label: string | null; mod_option: string | null }

function offered(modifiers: Modifier[], label: string, option: string): boolean {
  return modifiers.some(m => m.label === label && m.options.includes(option));
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = await costsBlocks(actor.restaurantId);
  if (blocked) return blocked;
  const body = await jsonBody<{ itemId?: unknown; lines?: unknown }>(req);
  const itemId = uuidOf(body?.itemId);
  if (!itemId || !Array.isArray(body?.lines)) return await apiError("apiErr.invalidRequest", 400);
  if (body.lines.length > MAX_RECIPE_LINES) return await apiError("apiErr.recipeTooLong", 400, { n: MAX_RECIPE_LINES });

  const db = createAdminClient();
  const { data: item } = await db.from("menu_items").select("name, modifiers")
    .eq("id", itemId).eq("restaurant_id", actor.restaurantId).maybeSingle();
  if (!item) return await apiError("apiErr.notFound", 404);
  const modifiers = (item.modifiers ?? []) as Modifier[];

  const lines: CleanLine[] = [];
  const seen = new Set<string>();
  for (const raw of body.lines as LineBody[]) {
    const ingredientId = uuidOf(raw?.ingredientId);
    const quantity = recipeQuantity(raw?.quantity);
    if (!ingredientId || quantity === null) return await apiError(quantityRefusal(raw?.quantity, "apiErr.recipeQuantity"), 400);
    const label = typeof raw.modLabel === "string" && raw.modLabel ? raw.modLabel : null;
    const option = typeof raw.modOption === "string" && raw.modOption ? raw.modOption : null;
    if ((label === null) !== (option === null)) return await apiError("apiErr.recipeChoice", 400);
    if (label !== null && option !== null && !offered(modifiers, label, option)) return await apiError("apiErr.recipeChoice", 400);
    const key = `${ingredientId}|${label ?? ""}|${option ?? ""}`;
    if (seen.has(key)) return await apiError("apiErr.recipeDuplicate", 400);
    seen.add(key);
    lines.push({ ingredient_id: ingredientId, quantity, mod_label: label, mod_option: option });
  }

  const { data: count, error } = await db.rpc("replace_recipe", {
    p_restaurant: actor.restaurantId, p_item: itemId, p_lines: lines,
  });
  if (error) return await apiError("apiErr.generic", 500);
  if (count === -1) return await apiError("apiErr.notFound", 404);
  if (count === -2) return await apiError("apiErr.recipeIngredient", 409);
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "costs", action: "updated",
    detail: logDetail({ note: item.name }),
  });
  return NextResponse.json({ ok: true, lines: count });
}
