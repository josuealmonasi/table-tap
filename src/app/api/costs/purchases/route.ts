import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { actingManager } from "@/lib/api-guard";
import { costsBlocks, uuidOf } from "@/lib/costs/guard";
import { decimal, MAX_PACK_PRICE, packPrice, quantityRefusal } from "@/lib/costs/input";

export const runtime = "nodejs";

/** More packs than anybody receives in one delivery. */
const MAX_PACKS = 10_000;
/** `ingredient_purchases.quantity`'s check: 10,000 kg of one thing, in grams. */
const MAX_PURCHASE_QUANTITY = 10_000_000;

// POST /api/costs/purchases — { ingredientId, packs, total }: a delivery came
// in. It adds to what the shelf should hold, and the price it came at is the
// ingredient's price now: `record_purchase_v2` writes both in one transaction,
// and the price trigger keeps the change. Owner and managers.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = await costsBlocks(actor.restaurantId);
  if (blocked) return blocked;
  const body = await jsonBody<{ ingredientId?: unknown; packs?: unknown; total?: unknown; ref?: unknown; packSize?: unknown }>(req);
  const ref = uuidOf(body?.ref);
  if (body?.ref !== undefined && !ref) return await apiError("apiErr.invalidRequest", 400);
  const ingredientId = uuidOf(body?.ingredientId);
  if (!body || !ingredientId) return await apiError("apiErr.invalidRequest", 400);
  const packs = decimal(body.packs, MAX_PACKS, 3);
  if (packs === null || packs <= 0) return await apiError(quantityRefusal(body.packs, "apiErr.purchasePacks"), 400);
  const total = packPrice(body.total);
  if (total === null) return await apiError("apiErr.purchaseTotal", 400);
  // A delivery's price becomes the ingredient's price: a total of 0 made every
  // recipe that uses it free in the margins until the next delivery.
  if (total <= 0) return await apiError("apiErr.purchaseTotalZero", 400);
  // The price per pack and the quantity are derived, and the tables refuse
  // either past its limit: answer that here as what was typed, not as a 500.
  if (total / packs > MAX_PACK_PRICE) return await apiError("apiErr.purchaseTooLarge", 400);

  // The pack size the form showed is part of what was entered: changed by
  // another manager meanwhile, two 1-litre packs were recorded as 4 litres and
  // the derived unit cost halved (D2, end-to-end review). The writer compares
  // it under the ingredient row lock, after answering a retry already saved;
  // read here first, the edit could land between the read and the write. A
  // retry goes to the writer even without one, to be answered if it was saved.
  const packSize = typeof body.packSize === "number" && Number.isFinite(body.packSize) && body.packSize > 0 ? body.packSize : null;
  if (packSize === null && !ref) return await apiError("apiErr.purchasePackChanged", 409);
  if (packSize !== null && packs * packSize > MAX_PURCHASE_QUANTITY) return await apiError("apiErr.purchaseTooLarge", 400);

  const db = createAdminClient();
  const { data: id, error } = await db.rpc(ref ? "record_purchase_once_v3" : "record_purchase_v2", {
    ...(ref ? { p_ref: ref } : {}),
    p_restaurant: actor.restaurantId, p_ingredient: ingredientId, p_packs: packs, p_total: total, p_actor: actor.email,
    p_pack_size: packSize,
  });
  if (error?.code === "PT412") return await apiError("apiErr.purchasePackChanged", 409);
  if (error?.code === "PT409") return await apiError("apiErr.retryConflict", 409);
  // A check constraint: a limit the checks above did not see (a retry sent no
  // pack size). What was typed is refused, the server did not fail.
  if (error?.code === "23514") return await apiError("apiErr.purchaseTooLarge", 400);
  if (error) return await apiError("apiErr.generic", 500);
  if (!id) return await apiError("apiErr.notFound", 404);
  if (!ref) {
    const { data: ingredient } = await db.from("ingredients").select("name").eq("id", ingredientId).eq("restaurant_id", actor.restaurantId).maybeSingle();
    await logEvent({
      restaurantId: actor.restaurantId, actor: actor.email, entity: "costs", action: "paid",
      detail: logDetail({ note: `${ingredient?.name ?? ""} × ${packs}`, amount: total.toFixed(2) }),
    });
  }
  return NextResponse.json({ ok: true, id });
}
