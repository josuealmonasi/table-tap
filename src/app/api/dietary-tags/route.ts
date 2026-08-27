import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingManager } from "@/lib/api-guard";
import { frozenBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmoji } from "@/lib/icon-groups";
import { tagKey } from "@/lib/dietary";

export const runtime = "nodejs";

/**
 * The restaurant's dietary and allergen tags.
 *
 * Management: it is what the diner reads on the dish. Written with the service
 * key, so EVERY query is scoped to the caller's restaurant — somebody else's
 * id finds nothing.
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
  // With no `key` there is nowhere to store it on the dish. It happens when
  // somebody types only an emoji, and saying so beats creating a phantom tag.
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

  // The unique index is per restaurant: two tags with the same name on one menu
  // would be two identical filters in the diner's menu.
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

  // The `key` is NOT touched on rename: it is what every dish stores, and moving
  // it would detach them all from their tag in silence.
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

  // And it comes off the dishes that carried it. Leaving the key loose inside
  // the array breaks nothing today — rendering ignores what it does not know —
  // but it would come back on its own the day somebody creates another tag with
  // the same name, and nobody would understand why.
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
