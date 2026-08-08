import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMembership, MANAGES } from "@/lib/membership";
import type { PromotionKind } from "@/lib/promotions";

export const runtime = "nodejs";

// Promotion management for owners and managers: combo bundles and quantity
// deals. Same shape as /api/coupons — role check, then write with the secret
// key, always scoped to the caller's restaurant.

async function actingManagerRestaurant(): Promise<string | null> {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership || !MANAGES(membership.role)) return null;
  return membership.restaurant.id;
}

interface Body {
  kind?: PromotionKind;
  name?: string;
  emoji?: string;
  description?: string | null;
  comboPrice?: number | null;
  buyQty?: number | null;
  payQty?: number | null;
  tiers?: { qty: number; price: number }[] | null;
  items?: { itemId: string; qty: number }[];
}

/** Checks the fields that matter for each kind, so a broken deal can't be saved. */
function validate(body: Body): { error: string } | null {
  if (!body.name?.trim()) return { error: "Give the promotion a name." };
  if (!body.items?.length) return { error: "Pick at least one product." };

  if (body.kind === "combo") {
    const price = Number(body.comboPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return { error: "Enter the combo price." };
    }
    if (body.items.length < 2) {
      return { error: "A combo needs at least two products." };
    }
  } else if (body.kind === "bogo") {
    const buy = Math.floor(Number(body.buyQty));
    const pay = Math.floor(Number(body.payQty));
    if (!Number.isFinite(buy) || !Number.isFinite(pay) || buy < 2 || pay < 1) {
      return { error: "Enter how many they take and how many they pay for." };
    }
    if (pay >= buy) return { error: "They must pay for fewer than they take." };
  } else if (body.kind === "tiered") {
    const tiers = (body.tiers ?? []).filter(t => Number(t.qty) > 0 && Number(t.price) >= 0);
    if (tiers.length === 0) return { error: "Add at least one price break." };
  } else {
    return { error: "Pick a promotion type." };
  }
  return null;
}

// POST /api/promotions — create a promotion and link its products.
export async function POST(req: NextRequest) {
  const restaurantId = await actingManagerRestaurant();
  if (!restaurantId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as Body;
  const bad = validate(body);
  if (bad) return NextResponse.json(bad, { status: 400 });

  const db = createAdminClient();

  // Only products belonging to this restaurant can be put in a promotion.
  const itemIds = body.items!.map(i => i.itemId);
  const { data: owned } = await db
    .from("menu_items")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .in("id", itemIds);
  if ((owned?.length ?? 0) !== itemIds.length) {
    return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  }

  const { data: created, error } = await db
    .from("promotions")
    .insert({
      restaurant_id: restaurantId,
      kind: body.kind,
      name: body.name!.trim(),
      emoji: body.emoji || "🎁",
      description: body.description?.trim() || null,
      combo_price: body.kind === "combo" ? Number(body.comboPrice) : null,
      buy_qty: body.kind === "bogo" ? Math.floor(Number(body.buyQty)) : null,
      pay_qty: body.kind === "bogo" ? Math.floor(Number(body.payQty)) : null,
      tiers: body.kind === "tiered" ? body.tiers : null,
    })
    .select("id")
    .single();
  if (error || !created) {
    return NextResponse.json({ error: "Could not create the promotion." }, { status: 500 });
  }

  const { error: linkErr } = await db.from("promotion_items").insert(
    body.items!.map(i => ({
      promotion_id: created.id,
      item_id: i.itemId,
      qty: Math.max(1, Math.floor(i.qty || 1)),
    })),
  );
  if (linkErr) {
    // Don't leave a promotion with no products — it would price as nothing.
    await db.from("promotions").delete().eq("id", created.id);
    return NextResponse.json({ error: "Could not attach the products." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// PATCH /api/promotions — pause or resume.
export async function PATCH(req: NextRequest) {
  const restaurantId = await actingManagerRestaurant();
  if (!restaurantId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as Body & { id?: string; active?: boolean };
  if (!body.id) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const db = createAdminClient();

  // Pause/resume: a lone `active` flag, and nothing else moves.
  if (typeof body.active === "boolean" && !body.name) {
    const { error } = await db
      .from("promotions")
      .update({ active: body.active })
      .eq("id", body.id)
      .eq("restaurant_id", restaurantId);
    if (error) return NextResponse.json({ error: "Could not update." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // A full edit. Validated exactly as a create is — an edit can put a
  // promotion into every invalid state a create can.
  const bad = validate(body);
  if (bad) return NextResponse.json(bad, { status: 400 });

  const itemIds = body.items!.map(i => i.itemId);
  const { data: owned } = await db
    .from("menu_items")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .in("id", itemIds);
  if ((owned?.length ?? 0) !== itemIds.length) {
    return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  }

  const { data: updated, error } = await db
    .from("promotions")
    .update({
      kind: body.kind,
      name: body.name!.trim(),
      emoji: body.emoji || "🎁",
      description: body.description?.trim() || null,
      combo_price: body.kind === "combo" ? Number(body.comboPrice) : null,
      buy_qty: body.kind === "bogo" ? Math.floor(Number(body.buyQty)) : null,
      pay_qty: body.kind === "bogo" ? Math.floor(Number(body.payQty)) : null,
      tiers: body.kind === "tiered" ? body.tiers : null,
    })
    .eq("id", body.id)
    .eq("restaurant_id", restaurantId)
    .select("id");
  if (error) return NextResponse.json({ error: "Could not update." }, { status: 500 });
  // A promotion belonging to another restaurant matches no row here, and
  // Postgres does not call an empty update an error. Without this check the
  // code below would go on to delete and rewrite that restaurant's components
  // — the id is the only thing scoping them.
  if (!updated?.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Replace the product list wholesale. Diffing it would be more code for the
  // same result, and the rows carry nothing worth preserving. Safe to scope by
  // promotion_id alone now that ownership is proven above.
  await db.from("promotion_items").delete().eq("promotion_id", body.id);
  const { error: linkErr } = await db.from("promotion_items").insert(
    body.items!.map(i => ({
      promotion_id: body.id,
      item_id: i.itemId,
      qty: Math.max(1, Math.floor(i.qty || 1)),
    })),
  );
  if (linkErr) {
    return NextResponse.json({ error: "Could not attach the products." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/promotions — remove it (promotion_items cascades).
export async function DELETE(req: NextRequest) {
  const restaurantId = await actingManagerRestaurant();
  if (!restaurantId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { error } = await createAdminClient()
    .from("promotions")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId);
  if (error) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
