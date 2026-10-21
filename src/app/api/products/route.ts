import { NextRequest, NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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
  const body = await jsonBody<{ id?: unknown; changes?: unknown }>(req);
  const id = uuidOf(body?.id);
  if (!id || !body?.changes || typeof body.changes !== "object" || Array.isArray(body.changes)) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const changes = Object.fromEntries(Object.entries(body.changes).filter(([key]) => FIELDS.has(key)));
  if (!Object.keys(changes).length) return await apiError("apiErr.invalidRequest", 400);
  // Keep the browser's RLS and plan guards as well as this route's scope.
  const db = await createClient();
  const { data, error } = await db.from("menu_items").update(changes)
    .eq("id", id).eq("restaurant_id", actor.restaurantId).eq("is_addon", false).select("id").maybeSingle();
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
