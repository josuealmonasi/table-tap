import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingManager } from "@/lib/api-guard";
import { frozenBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmoji, type IconVariant } from "@/lib/icon-groups";

export const runtime = "nodejs";

/**
 * The restaurant's own icon-picker groups.
 *
 * Management, like menus: this is how the menu looks from the inside, not money
 * or logins. Written with the service key and ALWAYS scoped to the caller's
 * restaurant — somebody else's id finds nothing.
 */

interface Body {
  id?: string;
  name?: string;
  variant?: IconVariant;
  icons?: { emoji: string; label?: string }[];
}

const VARIANTS: IconVariant[] = ["product", "addon"];

/** What can be stored: real emoji, no repeats, and not a hundred of them. */
function cleanIcons(icons: Body["icons"]): { emoji: string; label: string | null }[] {
  const seen = new Set<string>();
  const out: { emoji: string; label: string | null }[] = [];
  for (const icon of icons ?? []) {
    const emoji = (icon.emoji ?? "").trim();
    if (!isEmoji(emoji) || seen.has(emoji)) continue;
    seen.add(emoji);
    out.push({ emoji, label: icon.label?.trim().slice(0, 30) || null });
    if (out.length >= 40) break;
  }
  return out;
}

async function writeIcons(groupId: string, icons: ReturnType<typeof cleanIcons>) {
  const db = createAdminClient();
  // Replaced wholesale: it is a short list, so the order that arrives is the
  // order that stays, with no reconciling of additions and removals one by one.
  await db.from("icon_group_items").delete().eq("group_id", groupId);
  if (icons.length === 0) return;
  await db.from("icon_group_items").insert(
    icons.map((icon, i) => ({ group_id: groupId, ...icon, sort_order: i })),
  );
}

export async function POST(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;

  const body = (await req.json().catch(() => ({}))) as Body;
  const name = body.name?.trim();
  if (!name || !VARIANTS.includes(body.variant as IconVariant)) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const icons = cleanIcons(body.icons);
  if (icons.length === 0) return await apiError("apiErr.iconGroupEmpty", 400);

  const db = createAdminClient();
  const { count } = await db
    .from("icon_groups")
    .select("*", { count: "exact", head: true })
    .eq("restaurant_id", actor.restaurantId);

  const { data, error } = await db
    .from("icon_groups")
    .insert({
      restaurant_id: actor.restaurantId,
      variant: body.variant,
      name: name.slice(0, 40),
      sort_order: count ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) return await apiError("apiErr.invalidRequest", 500);
  await writeIcons(data.id, icons);
  return NextResponse.json({ id: data.id });
}

export async function PATCH(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.id) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();
  // Scoped to the caller's restaurant: without this another's id would be editable.
  const { data: mine } = await db
    .from("icon_groups")
    .select("id")
    .eq("id", body.id)
    .eq("restaurant_id", actor.restaurantId)
    .maybeSingle();
  if (!mine) return await apiError("apiErr.notFound", 404);

  const patch: { name?: string; variant?: IconVariant } = {};
  const name = body.name?.trim();
  if (name) patch.name = name.slice(0, 40);
  if (body.variant && VARIANTS.includes(body.variant)) patch.variant = body.variant;
  if (Object.keys(patch).length) {
    await db.from("icon_groups").update(patch).eq("id", mine.id);
  }

  if (body.icons) {
    const icons = cleanIcons(body.icons);
    if (icons.length === 0) return await apiError("apiErr.iconGroupEmpty", 400);
    await writeIcons(mine.id, icons);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { id } = (await req.json().catch(() => ({}))) as Body;
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  // The icons go with the group via the foreign key. Dishes already using one
  // lose nothing: they store the emoji, not the group.
  // With `.select()` to know whether it really deleted anything: PostgREST does
  // not complain when the filter matches nothing, and another's id would leave
  // here with a 200 saying it had. The row is safe, but the answer was lying.
  const { data, error } = await createAdminClient()
    .from("icon_groups")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId)
    .select("id");

  if (error) return await apiError("apiErr.invalidRequest", 500);
  if (!data?.length) return await apiError("apiErr.notFound", 404);
  return NextResponse.json({ ok: true });
}
