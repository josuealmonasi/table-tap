import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { actingManager } from "@/lib/api-guard";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";
import {
  promoPricingError,
  type PricedProduct,
  type PromoShape,
} from "@/lib/promo-guard";
import type { Body } from "@/lib/promotion-input";
import { savePromotion } from "@/lib/promotion-save";

/** Beyond any real price break; a stored tier is what checkout prices. */
const MAX_TIER_QTY = 1000;
const MAX_TIERS = 20;

export const runtime = "nodejs";

// Promotion management for owners and managers: combo bundles and quantity
// deals. Same shape as /api/coupons — role check, then write with the secret
// key, always scoped to the caller's restaurant.

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
    // Whole units within reason, a real price, and a handful of brackets: what
    // is stored is what pricing reads, so anything else must not be saved.
    const tiers = body.tiers ?? [];
    const sound = (t: { qty?: unknown; price?: unknown }) =>
      Number.isInteger(Number(t.qty)) && Number(t.qty) >= 1 && Number(t.qty) <= MAX_TIER_QTY &&
      Number.isFinite(Number(t.price)) && Number(t.price) >= 0;
    if (tiers.length === 0) return { key: "apiErr.promoTierNeeded" };
    if (tiers.length > MAX_TIERS || !tiers.every(sound)) return { key: "apiErr.promoTierInvalid" };
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

  // Creating needs the feature; a downgrade keeps saved promotions. A freeze
  // allows only switching one off, so its terms cannot change underneath diners.
  const frozen = await frozenBlocks(restaurantId);
  if (frozen) return frozen;

  const blocked = await planBlocks(restaurantId, "promotions");
  if (blocked) return blocked;

  const body = await jsonBody<Body>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
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

  // Don't leave a promotion with no products — it would price as nothing.
  // The parent and its links now commit together, including on creation.
  return savePromotion(db, restaurantId, null, body);
}

// PATCH /api/promotions — pause or resume.
export async function PATCH(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const restaurantId = actor.restaurantId;

  const body = await jsonBody<Body & { id?: string; active?: boolean }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  if (!body.id) return await apiError("apiErr.invalidRequest", 400);

  const offOnly = body.active === false && Object.keys(body).length === 2;
  if (!offOnly) {
    const frozen = await frozenBlocks(restaurantId);
    if (frozen) return frozen;
  }
  const db = createAdminClient();

  // Pause/resume: a lone `active` flag, and nothing else moves.
  if (typeof body.active === "boolean" && Object.keys(body).length === 2) {
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

  // A promotion belonging to another restaurant matches no row, and Postgres
  // does not call an empty update an error. The transaction proves ownership
  // before touching components and returns null for a missing promotion.
  // Replace the product list wholesale. Diffing it would be more code for the
  // same result, and the rows carry nothing worth preserving.
  //
  // The old delete/insert could fail on a dish deleted mid-edit and leave an
  // active promotion empty. Restoring only the old links also kept the new
  // price. A failed replacement now rolls back both terms and components.
  return savePromotion(db, restaurantId, body.id, body);
}

// DELETE /api/promotions — remove it (promotion_items cascades).
export async function DELETE(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const restaurantId = actor.restaurantId;

  const frozen = await frozenBlocks(restaurantId);
  if (frozen) return frozen;

  const body = await jsonBody<Record<string, unknown>>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { id } = body;
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  const { error } = await createAdminClient()
    .from("promotions")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", restaurantId);
  if (error) return await apiError("apiErr.promoDelete", 500);
  return NextResponse.json({ ok: true });
}
