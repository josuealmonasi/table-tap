import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { actingManager } from "@/lib/api-guard";
import { costsBlocks, uuidOf } from "@/lib/costs/guard";
import { ingredientName, ingredientUnit, leadDays, MAX_INGREDIENTS, packPrice, packSize, quantityRefusal, supplierName, type IngredientUnit } from "@/lib/costs/input";

export const runtime = "nodejs";

// /api/costs/ingredients — the restaurant's ingredients, for the owner and the
// managers on a tier with costs.
//
// POST   { name, unit, packSize, packUnit, packPrice, supplier?, leadDays? }   add one
// PATCH  { id, name, packSize, packUnit, packPrice, supplier?, leadDays? }     change one
// DELETE { id }                                                      archive it
//
// A unit is fixed once the ingredient exists: 18 in a recipe means 18 g, and
// turning the grams into millilitres would make every recipe say something
// else. Every change of price is kept, by the table's own trigger.

interface IngredientBody {
  id?: unknown; name?: unknown; unit?: unknown; packSize?: unknown; packUnit?: unknown; packPrice?: unknown; supplier?: unknown;
  leadDays?: unknown;
}

type Fields = { name: string; pack_size: number; pack_price: number; supplier: string | null; lead_days?: number };

async function fieldsOf(body: IngredientBody, unit: IngredientUnit): Promise<Fields | NextResponse> {
  const name = ingredientName(body.name);
  if (!name) return await apiError("apiErr.ingredientName", 400);
  const size = packSize(body.packSize, body.packUnit, unit);
  if (size === null) return await apiError(quantityRefusal(body.packSize, "apiErr.packSize"), 400);
  const price = packPrice(body.packPrice);
  if (price === null) return await apiError("apiErr.packPrice", 400);
  const supplier = supplierName(body.supplier);
  if (supplier === "bad") return await apiError("apiErr.supplierName", 400);
  // Absent keeps what it was (2 days for a new one).
  if (body.leadDays === undefined) return { name, pack_size: size, pack_price: price, supplier };
  const lead = leadDays(body.leadDays);
  if (lead === null) return await apiError("apiErr.leadDays", 400);
  return { name, pack_size: size, pack_price: price, supplier, lead_days: lead };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = await costsBlocks(actor.restaurantId);
  if (blocked) return blocked;
  const body = await jsonBody<IngredientBody>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const unit = ingredientUnit(body.unit);
  if (!unit) return await apiError("apiErr.ingredientUnit", 400);
  const fields = await fieldsOf(body, unit);
  if (fields instanceof NextResponse) return fields;

  const db = createAdminClient();
  const { count } = await db.from("ingredients").select("id", { count: "exact", head: true })
    .eq("restaurant_id", actor.restaurantId).is("archived_at", null);
  if ((count ?? 0) >= MAX_INGREDIENTS) return await apiError("apiErr.tooManyIngredients", 409, { n: MAX_INGREDIENTS });

  const { data, error } = await db.from("ingredients")
    .insert({ restaurant_id: actor.restaurantId, unit, ...fields, updated_by: actor.email })
    .select("id").single();
  if (error?.code === "23505") return await apiError("apiErr.ingredientExists", 409);
  if (error || !data) return await apiError("apiErr.generic", 500);
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "costs", action: "created",
    detail: logDetail({ note: fields.name }),
  });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = await costsBlocks(actor.restaurantId);
  if (blocked) return blocked;
  const body = await jsonBody<IngredientBody>(req);
  const id = uuidOf(body?.id);
  if (!body || !id) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();
  const { data: current } = await db.from("ingredients").select("unit")
    .eq("id", id).eq("restaurant_id", actor.restaurantId).is("archived_at", null).maybeSingle();
  if (!current) return await apiError("apiErr.notFound", 404);
  const fields = await fieldsOf(body, current.unit as IngredientUnit);
  if (fields instanceof NextResponse) return fields;

  const { data, error } = await db.from("ingredients").update({ ...fields, updated_by: actor.email })
    .eq("id", id).eq("restaurant_id", actor.restaurantId).is("archived_at", null).select("id");
  if (error?.code === "23505") return await apiError("apiErr.ingredientExists", 409);
  if (error) return await apiError("apiErr.generic", 500);
  if (!data?.length) return await apiError("apiErr.notFound", 404);
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "costs", action: "updated",
    detail: logDetail({ note: fields.name }),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = await costsBlocks(actor.restaurantId);
  if (blocked) return blocked;
  const id = uuidOf((await jsonBody<{ id?: unknown }>(req))?.id);
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();
  const { data: row } = await db.from("ingredients").select("name")
    .eq("id", id).eq("restaurant_id", actor.restaurantId).maybeSingle();
  const { data: lines, error } = await db.rpc("archive_ingredient", {
    p_restaurant: actor.restaurantId, p_ingredient: id, p_actor: actor.email,
  });
  if (error) return await apiError("apiErr.generic", 500);
  if (lines === -1) return await apiError("apiErr.notFound", 404);
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "costs", action: "deleted",
    detail: logDetail({ note: row?.name ?? "" }),
  });
  return NextResponse.json({ ok: true, recipeLinesRemoved: lines });
}
