import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { actingManager } from "@/lib/api-guard";
import { costsBlocks, uuidOf } from "@/lib/costs/guard";
import { decimal, packPrice } from "@/lib/costs/input";

export const runtime = "nodejs";

/** More packs than anybody receives in one delivery. */
const MAX_PACKS = 10_000;

// POST /api/costs/purchases — { ingredientId, packs, total }: a delivery came
// in. It adds to what the shelf should hold, and the price it came at is the
// ingredient's price now: `record_purchase` writes both in one transaction,
// and the price trigger keeps the change. Owner and managers.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = await costsBlocks(actor.restaurantId);
  if (blocked) return blocked;
  const body = await jsonBody<{ ingredientId?: unknown; packs?: unknown; total?: unknown; ref?: unknown }>(req);
  const ref = uuidOf(body?.ref);
  if (body?.ref !== undefined && !ref) return await apiError("apiErr.invalidRequest", 400);
  const ingredientId = uuidOf(body?.ingredientId);
  if (!body || !ingredientId) return await apiError("apiErr.invalidRequest", 400);
  const packs = decimal(body.packs, MAX_PACKS, 3);
  if (packs === null || packs <= 0) return await apiError("apiErr.purchasePacks", 400);
  const total = packPrice(body.total);
  if (total === null) return await apiError("apiErr.purchaseTotal", 400);

  const db = createAdminClient();
  const { data: id, error } = await db.rpc(ref ? "record_purchase_once" : "record_purchase", {
    ...(ref ? { p_ref: ref } : {}),
    p_restaurant: actor.restaurantId, p_ingredient: ingredientId, p_packs: packs, p_total: total, p_actor: actor.email,
  });
  if (error) return await apiError("apiErr.generic", 500);
  if (!id) return await apiError("apiErr.notFound", 404);
  const { data: ingredient } = await db.from("ingredients").select("name").eq("id", ingredientId).maybeSingle();
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "costs", action: "paid",
    detail: logDetail({ note: `${ingredient?.name ?? ""} × ${packs}`, amount: total.toFixed(2) }),
  });
  return NextResponse.json({ ok: true, id });
}
