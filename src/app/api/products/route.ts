import { NextRequest, NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { parsePlanLimit, planLimitText } from "@/lib/plan-error";
import { planLabel } from "@/lib/plan";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { modifierEditBlocks } from "@/lib/costs/modifier-edit";
import { uuidOf } from "@/lib/costs/guard";

export const runtime = "nodejs";
const FIELDS = new Set(["name", "description", "price", "image_url", "emoji", "popular",
  "modifiers", "dietary", "discount_pct", "skips_kitchen", "category_id"]);
const count = (value: unknown): value is number | null => value === null ||
  (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2147483647);

/** A description or price edit never writes the stock a form opened with. */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;
  const body = await jsonBody<{ id?: unknown; changes?: unknown; addonIds?: unknown; menuId?: unknown; categoryId?: unknown }>(req);
  const id = uuidOf(body?.id);
  const input = body?.changes ?? {};
  const menuId = uuidOf(body?.menuId);
  if (body?.id !== undefined && !id) return await apiError("apiErr.invalidRequest", 400);
  if ((!id && !menuId) || !body || typeof input !== "object" || input === null || Array.isArray(input)) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const changes = Object.fromEntries(Object.entries(input).filter(([key]) => FIELDS.has(key)));
  if (id && "modifiers" in changes) {
    const blocked = await modifierEditBlocks(actor.restaurantId, id, changes.modifiers);
    if (blocked) return blocked;
  }
  if (body.addonIds !== undefined) {
    const categoryId = body.categoryId == null ? null : uuidOf(body.categoryId);
    if (!id && body.categoryId != null && !categoryId) return await apiError("apiErr.invalidRequest", 400);
    if (!id && "stock" in input) {
      const stock = (input as { stock?: unknown }).stock;
      if (!count(stock)) return await apiError("apiErr.invalidRequest", 400);
      if (stock !== null) {
        const blocked = await planBlocks(actor.restaurantId, "inventory");
        if (blocked) return blocked;
      }
      changes.stock = stock;
    }
    if (!Array.isArray(body.addonIds) || body.addonIds.some(a => !uuidOf(a)) || new Set(body.addonIds).size !== body.addonIds.length) {
      return await apiError("apiErr.invalidRequest", 400);
    }
    const { data, error } = await createAdminClient().rpc("save_product_addons_v1", {
      p_restaurant: actor.restaurantId, p_product: id, p_addons: body.addonIds, p_changes: changes,
      p_menu: id ? null : menuId, p_category: id ? null : categoryId,
    });
    if (error?.code === "PT422") return await apiError("apiErr.recipeModifierEdit", 409, { name: error.details });
    if (error?.message.includes("tt_plan_frozen")) return await apiError("plan.frozen", 402);
    if (error?.message.includes("tt_plan_feature")) return (await planBlocks(actor.restaurantId, "inventory")) ?? await apiError("write.createProduct", 409);
    const limit = parsePlanLimit(error?.message);
    if (limit) {
      const { key, vars } = planLimitText(limit);
      return await apiError(key, 403, { ...vars, plan: planLabel(vars.plan) });
    }
    if (error) return await apiError(id ? "write.updateProductExtras" : "write.createProduct", 503);
    if (!data) return await apiError("apiErr.notFound", 404);
    return NextResponse.json({ ok: true, id: data });
  }
  if (!id || !Object.keys(changes).length) return await apiError("apiErr.invalidRequest", 400);
  // Keep the browser's RLS and plan guards as well as this route's scope.
  const db = await createClient();
  const { data, error } = await db.from("menu_items").update(changes)
    .eq("id", id).eq("restaurant_id", actor.restaurantId).eq("is_addon", false).select("id").maybeSingle();
  if (error?.code === "PT422") return await apiError("apiErr.recipeModifierEdit", 409, { name: error.details });
  if (error) return await apiError("write.updateProduct", 503);
  if (!data) return await apiError("apiErr.notFound", 404);
  return NextResponse.json({ ok: true });
}

/** A recount is its own locked operation, based on what the manager saw. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = (await frozenBlocks(actor.restaurantId)) ?? (await planBlocks(actor.restaurantId, "inventory"));
  if (blocked) return blocked;
  const body = await jsonBody<{ id?: unknown; stock?: unknown; expectedStock?: unknown; expectedEpoch?: unknown }>(req);
  const id = uuidOf(body?.id);
  if (!id || !body || !count(body.stock) || !count(body.expectedStock) ||
    typeof body.expectedEpoch !== "number" || !Number.isInteger(body.expectedEpoch) || body.expectedEpoch < 0 || body.expectedEpoch > 2147483647) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const { data, error } = await createAdminClient().rpc("recount_stock", {
    p_restaurant: actor.restaurantId, p_item: id, p_stock: body.stock,
    p_expected_stock: body.expectedStock, p_expected_epoch: body.expectedEpoch,
  });
  if (error) return await apiError("write.updateProduct", 503);
  if (data === "missing") return await apiError("apiErr.notFound", 404);
  if (data !== "counted") return await apiError("menu.stockChanged", 409);
  return NextResponse.json({ ok: true });
}
