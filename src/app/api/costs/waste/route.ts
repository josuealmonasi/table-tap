import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { actingManager, actingStaff } from "@/lib/api-guard";
import { costsBlocks, uuidOf } from "@/lib/costs/guard";
import { dishCount, quantityRefusal, recipeQuantity, wasteNote } from "@/lib/costs/input";
import { wasteProduct, type WasteProduct } from "@/lib/costs/waste-product";
import { PRODUCT_ONLY_REASONS, WASTE_REASONS, type WasteReason } from "@/lib/costs/usage";

export const runtime = "nodejs";

// /api/costs/waste — what was thrown away, and why.
//
// POST   { ingredientId | itemId, quantity, reason, note?, mods?, extras? }   anyone on the team
// DELETE { id }                                                a manager, for an entry made by mistake
//
// The barista who spills the milk is the one who knows, so the whole team
// records; only a manager takes an entry back. Its cost is fixed now, at
// today's prices, and a dish whose stock is counted loses the units too —
// in the same transaction, by `record_waste`. Taking an entry back does not
// return them: the dish's count is corrected on the menu, where it is kept.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = await costsBlocks(actor.restaurantId);
  if (blocked) return blocked;
  const body = await jsonBody<{ ingredientId?: unknown; itemId?: unknown; quantity?: unknown; reason?: unknown; note?: unknown; ref?: unknown; mods?: unknown; extras?: unknown }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const ref = uuidOf(body?.ref);
  if (body?.ref !== undefined && !ref) return await apiError("apiErr.invalidRequest", 400);
  const ingredientId = uuidOf(body.ingredientId);
  const itemId = uuidOf(body.itemId);
  if (!ingredientId === !itemId) return await apiError("apiErr.wasteWhat", 400);
  // A dish goes in the bin whole; an ingredient by the gram.
  const quantity = itemId ? dishCount(body.quantity) : recipeQuantity(body.quantity);
  if (quantity === null) return await apiError(quantityRefusal(body.quantity, "apiErr.wasteQuantity"), 400);
  const reason = WASTE_REASONS.includes(body.reason as WasteReason) ? (body.reason as WasteReason) : null;
  if (!reason) return await apiError("apiErr.wasteReason", 400);
  // Only a dish can come back from a table; an ingredient never left the kitchen.
  if (ingredientId && PRODUCT_ONLY_REASONS.includes(reason)) return await apiError("apiErr.wasteReason", 400);

  let cost: number | null = null;
  let productChoices: WasteProduct["choices"] | undefined;
  try {
    if (itemId) {
      const result = await wasteProduct(actor.restaurantId, itemId, quantity, body.mods, body.extras);
      if ("refusal" in result) return await apiError(result.refusal === "missing" ? "apiErr.notFound" : "apiErr.wasteChoices", result.refusal === "missing" ? 404 : 400);
      cost = result.value.cost;
      productChoices = result.value.choices;
    } else {
      const { data, error } = await createAdminClient().from("ingredients").select("unit_cost")
        .eq("id", ingredientId!).eq("restaurant_id", actor.restaurantId).maybeSingle();
      if (error) return await apiError("apiErr.generic", 503);
      if (!data) return await apiError("apiErr.notFound", 404);
      cost = Math.round(Number(data.unit_cost) * quantity * 100) / 100;
    }
  } catch {
    return await apiError("apiErr.generic", 503);
  }
  const { data: id, error } = await createAdminClient().rpc(ref ? "record_waste_once" : "record_waste", {
    ...(ref ? { p_ref: ref } : {}),
    p_restaurant: actor.restaurantId, p_ingredient: ingredientId, p_item: itemId, p_quantity: quantity,
    ...(productChoices ? { p_choices: productChoices } : {}),
    p_reason: reason, p_note: wasteNote(body.note), p_cost: cost, p_actor: actor.email,
  });
  if (error?.code === "PT409") return await apiError("apiErr.retryConflict", 409);
  if (error) return await apiError("apiErr.generic", 500);
  if (!id) return await apiError("apiErr.notFound", 404);
  const { data: entry } = await createAdminClient().from("waste_entries").select("name").eq("id", id).maybeSingle();
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "costs", action: "written_off",
    detail: logDetail({ note: `${entry?.name ?? ""} × ${quantity}` }),
  });
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = await costsBlocks(actor.restaurantId);
  if (blocked) return blocked;
  const id = uuidOf((await jsonBody<{ id?: unknown }>(req))?.id);
  if (!id) return await apiError("apiErr.invalidRequest", 400);
  const { data, error } = await createAdminClient().from("waste_entries")
    .delete().eq("id", id).eq("restaurant_id", actor.restaurantId).select("name");
  if (error) return await apiError("apiErr.generic", 500);
  if (!data?.length) return await apiError("apiErr.notFound", 404);
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "costs", action: "deleted",
    detail: logDetail({ note: data[0].name }),
  });
  return NextResponse.json({ ok: true });
}
