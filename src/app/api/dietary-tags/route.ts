import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingManager } from "@/lib/api-guard";
import { frozenBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmoji } from "@/lib/icon-groups";
import { tagKey } from "@/lib/dietary";

export const runtime = "nodejs";

/**
 * Las etiquetas de dieta y alérgenos del restaurante.
 *
 * Gerencia: es lo que el comensal lee en el platillo. Se escribe con la llave
 * de servicio, así que TODA consulta va acotada al restaurante de quien pide —
 * un id de otro no encuentra nada.
 */

interface Body {
  id?: string;
  label?: string;
  labelEn?: string | null;
  emoji?: string;
}

const clean = (value: string | undefined | null, max: number) =>
  (value ?? "").trim().slice(0, max);

export async function POST(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;

  const body = (await req.json().catch(() => ({}))) as Body;
  const label = clean(body.label, 40);
  const key = tagKey(label);
  // Sin `key` no hay dónde guardarla dentro del platillo. Pasa cuando alguien
  // escribe sólo emoji, y es mejor decirlo que crear una etiqueta fantasma.
  if (!label || !key) return await apiError("apiErr.dietaryTagName", 400);

  const db = createAdminClient();
  const { count } = await db
    .from("dietary_tags")
    .select("*", { count: "exact", head: true })
    .eq("restaurant_id", actor.restaurantId);

  const { data, error } = await db
    .from("dietary_tags")
    .insert({
      restaurant_id: actor.restaurantId,
      key,
      label,
      label_en: clean(body.labelEn, 40) || null,
      emoji: isEmoji(body.emoji ?? "") ? clean(body.emoji, 8) : "🏷️",
      sort_order: count ?? 0,
    })
    .select("id")
    .single();

  // El índice único es por restaurante: dos etiquetas con el mismo nombre en
  // la misma carta serían dos filtros idénticos en el menú del comensal.
  if (error?.code === "23505") return await apiError("apiErr.dietaryTagTaken", 409);
  if (error || !data) return await apiError("apiErr.invalidRequest", 500);
  return NextResponse.json({ id: data.id });
}

export async function PATCH(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.id) return await apiError("apiErr.invalidRequest", 400);

  const patch: { label?: string; label_en?: string | null; emoji?: string } = {};
  const label = clean(body.label, 40);
  if (label) patch.label = label;
  if (body.labelEn !== undefined) patch.label_en = clean(body.labelEn, 40) || null;
  if (isEmoji(body.emoji ?? "")) patch.emoji = clean(body.emoji, 8);
  if (Object.keys(patch).length === 0) return await apiError("apiErr.invalidRequest", 400);

  // La `key` NO se toca al renombrar: es lo que guarda cada platillo, y
  // moverla los despegaría a todos de su etiqueta en silencio.
  const { data, error } = await createAdminClient()
    .from("dietary_tags")
    .update(patch)
    .eq("id", body.id)
    .eq("restaurant_id", actor.restaurantId)
    .select("id");

  if (error) return await apiError("apiErr.invalidRequest", 500);
  if (!data?.length) return await apiError("apiErr.notFound", 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { id } = (await req.json().catch(() => ({}))) as Body;
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();
  const { data: tag } = await db
    .from("dietary_tags")
    .select("id, key")
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId)
    .maybeSingle();
  if (!tag) return await apiError("apiErr.notFound", 404);

  // Y se despega de los platillos que la traían. Dejar la clave suelta dentro
  // del arreglo no rompe nada hoy —al pintar se ignora lo que no reconoce—
  // pero reaparecería sola el día que alguien cree otra etiqueta con el mismo
  // nombre, y nadie entendería por qué.
  const { data: tagged } = await db
    .from("menu_items")
    .select("id, dietary")
    .eq("restaurant_id", actor.restaurantId)
    .contains("dietary", [tag.key]);

  for (const item of (tagged as { id: string; dietary: string[] }[]) ?? []) {
    await db
      .from("menu_items")
      .update({ dietary: item.dietary.filter(k => k !== tag.key) })
      .eq("id", item.id)
      .eq("restaurant_id", actor.restaurantId);
  }

  const { error } = await db
    .from("dietary_tags")
    .delete()
    .eq("id", tag.id)
    .eq("restaurant_id", actor.restaurantId);

  if (error) return await apiError("apiErr.invalidRequest", 500);
  return NextResponse.json({ ok: true, unlinked: tagged?.length ?? 0 });
}
