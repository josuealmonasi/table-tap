import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { actingManager } from "@/lib/api-guard";
import { planBlocks } from "@/lib/plan-guard";
import {
  promoPricingError,
  type PricedProduct,
  type PromoShape,
} from "@/lib/promo-guard";
import type { PromotionKind } from "@/lib/promotions";

export const runtime = "nodejs";

// Promotion management for owners and managers: combo bundles and quantity
// deals. Same shape as /api/coupons — role check, then write with the secret
// key, always scoped to the caller's restaurant.

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
function validate(body: Body): { key: string } | null {
  if (!body.name?.trim()) return { key: "apiErr.promoName" };
  if (!body.items?.length) return { key: "apiErr.promoPickProduct" };

  if (body.kind === "combo") {
    const price = Number(body.comboPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return { key: "apiErr.promoComboPrice" };
    }
    if (body.items.length < 2) {
      return { key: "apiErr.promoComboTwo" };
    }
  } else if (body.kind === "bogo") {
    const buy = Math.floor(Number(body.buyQty));
    const pay = Math.floor(Number(body.payQty));
    if (!Number.isFinite(buy) || !Number.isFinite(pay) || buy < 2 || pay < 1) {
      return { key: "apiErr.promoBogoQty" };
    }
    if (pay >= buy) return { key: "apiErr.promoBogoLess" };
  } else if (body.kind === "tiered") {
    const tiers = (body.tiers ?? []).filter(
      t => Number(t.qty) > 0 && Number(t.price) >= 0,
    );
    if (tiers.length === 0) return { key: "apiErr.promoTierNeeded" };
  } else {
    return { key: "apiErr.promoKind" };
  }
  return null;
}

// POST /api/promotions — create a promotion and link its products.
export async function POST(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const restaurantId = actor.restaurantId;

  // Creating is gated, editing is not: a restaurant that drops a tier keeps
  // the promotions it already runs and must still be able to end them.
  const blocked = await planBlocks(restaurantId, "promotions");
  if (blocked) return blocked;

  const body = (await req.json()) as Body;
  const bad = validate(body);
  if (bad) return await apiError(bad.key);

  const db = createAdminClient();

  // Only products belonging to this restaurant can be put in a promotion.
  const itemIds = body.items!.map(i => i.itemId);
  const { data: owned } = await db
    .from("menu_items")
    .select("id, price, discount_pct")
    .eq("restaurant_id", restaurantId)
    .in("id", itemIds);
  if ((owned?.length ?? 0) !== itemIds.length) {
    return await apiError("apiErr.promoUnknownProduct", 400);
  }

  // A promotion that costs more than buying the products one by one is always
  // a mistake, and nothing downstream would catch it — the pricing engine
  // applies whatever the deal says.
  const pricingError = promoPricingError(
    body as PromoShape,
    new Map((owned as PricedProduct[]).map(p => [p.id, p])),
  );
  if (pricingError) return NextResponse.json({ error: pricingError }, { status: 400 });

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
    return await apiError("apiErr.promoCreate", 500);
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
    return await apiError("apiErr.promoAttach", 500);
  }

  return NextResponse.json({ ok: true });
}

// PATCH /api/promotions — pause or resume.
export async function PATCH(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const restaurantId = actor.restaurantId;

  const body = (await req.json()) as Body & { id?: string; active?: boolean };
  if (!body.id) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();

  // Pause/resume: a lone `active` flag, and nothing else moves.
  if (typeof body.active === "boolean" && !body.name) {
    const { error } = await db
      .from("promotions")
      .update({ active: body.active })
      .eq("id", body.id)
      .eq("restaurant_id", restaurantId);
    if (error) return await apiError("apiErr.promoUpdate", 500);
    return NextResponse.json({ ok: true });
  }

  // A full edit. Validated exactly as a create is — an edit can put a
  // promotion into every invalid state a create can.
  const bad = validate(body);
  if (bad) return await apiError(bad.key);

  const itemIds = body.items!.map(i => i.itemId);
  const { data: owned } = await db
    .from("menu_items")
    .select("id, price, discount_pct")
    .eq("restaurant_id", restaurantId)
    .in("id", itemIds);
  if ((owned?.length ?? 0) !== itemIds.length) {
    return await apiError("apiErr.promoUnknownProduct", 400);
  }

  // A promotion that costs more than buying the products one by one is always
  // a mistake, and nothing downstream would catch it — the pricing engine
  // applies whatever the deal says.
  const pricingError = promoPricingError(
    body as PromoShape,
    new Map((owned as PricedProduct[]).map(p => [p.id, p])),
  );
  if (pricingError) return NextResponse.json({ error: pricingError }, { status: 400 });

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
  if (error) return await apiError("apiErr.promoUpdate", 500);
  // A promotion belonging to another restaurant matches no row here, and
  // Postgres does not call an empty update an error. Without this check the
  // code below would go on to delete and rewrite that restaurant's components
  // — the id is the only thing scoping them.
  if (!updated?.length) {
    return await apiError("apiErr.notFound", 404);
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
    return await apiError("apiErr.promoAttach", 500);
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/promotions — remove it (promotion_items cascades).
export async function DELETE(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const restaurantId = actor.restaurantId;

  const { id } = await req.json();
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  const { error } = await createAdminClient()
    .from("promotions")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId);
  if (error) return await apiError("apiErr.promoDelete", 500);
  return NextResponse.json({ ok: true });
}
