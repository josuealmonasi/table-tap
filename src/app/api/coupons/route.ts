import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMembership, MANAGES } from "@/lib/membership";
import { isValidCouponFormat, normalizeCoupon } from "@/lib/coupons";
import { currentUser } from "@/lib/current-user";

export const runtime = "nodejs";

// Coupon management for owners and managers. Writes go through the secret key
// after the role check, matching /api/settings — managers have no direct RLS
// write path of their own to rely on.

interface Actor {
  restaurantId: string;
  email: string;
}

async function actingManager(): Promise<Actor | null> {
  const membership = await getMembership();
  if (!membership || !MANAGES(membership.role)) return null;
  const user = await currentUser();
  return { restaurantId: membership.restaurant.id, email: user?.email ?? "staff" };
}

/** The normalised fields, or the i18n key naming what's wrong with them. */
interface CouponFields {
  kind: "percent" | "fixed";
  value: number;
  maxUses: number | null;
  minSubtotal: number;
  startsAt: string | null;
  endsAt: string | null;
}

/** Validates and normalises the editable fields shared by POST and PATCH. */
function readFields(body: Record<string, unknown>): CouponFields | { key: string } {
  const kind = body.kind === "fixed" ? "fixed" : "percent";
  const value = Number(body.value);
  if (!Number.isFinite(value) || value <= 0) return { key: "apiErr.couponAmount" };
  if (kind === "percent" && value > 100) {
    return { key: "apiErr.couponPct" };
  }

  const rawMax = body.maxUses;
  const maxUses =
    rawMax === null || rawMax === undefined || rawMax === ""
      ? null
      : Math.floor(Number(rawMax));
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1)) {
    return { key: "apiErr.couponUses" };
  }

  const minSubtotal = Math.max(0, Number(body.minSubtotal) || 0);

  // Dates arrive as ISO strings (or empty for "no bound"). Reject anything
  // unparseable rather than silently storing null and losing the schedule.
  const readDate = (v: unknown): string | null | { key: string } => {
    if (v === null || v === undefined || v === "") return null;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? { key: "apiErr.couponDate" } : d.toISOString();
  };
  const startsAt = readDate(body.startsAt);
  const endsAt = readDate(body.endsAt);
  if (startsAt && typeof startsAt === "object") return startsAt;
  if (endsAt && typeof endsAt === "object") return endsAt;
  if (startsAt && endsAt && new Date(startsAt as string) >= new Date(endsAt as string)) {
    return { key: "apiErr.couponDateOrder" };
  }

  return {
    kind,
    value,
    maxUses,
    minSubtotal,
    startsAt: startsAt as string | null,
    endsAt: endsAt as string | null,
  };
}

// POST /api/coupons — create a code.
export async function POST(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = (await req.json()) as Record<string, unknown>;
  const code = normalizeCoupon(String(body.code ?? ""));
  if (!isValidCouponFormat(code)) {
    return await apiError("apiErr.couponShape", 400);
  }

  const fields = readFields(body);
  if ("key" in fields) return await apiError(fields.key);

  const { error } = await createAdminClient().from("coupons").insert({
    restaurant_id: actor.restaurantId,
    code,
    kind: fields.kind,
    value: fields.value,
    max_uses: fields.maxUses,
    min_subtotal: fields.minSubtotal,
    starts_at: fields.startsAt,
    ends_at: fields.endsAt,
    created_by_email: actor.email,
  });
  if (error) {
    // The unique index on (restaurant_id, upper(code)) is what actually
    // prevents duplicates — this just turns it into a readable message.
    const duplicate = error.code === "23505";
    return NextResponse.json(
      { error: duplicate ? "That code already exists." : "Could not create the coupon." },
      { status: duplicate ? 409 : 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

// PATCH /api/coupons — edit a code's terms, or switch it on/off.
export async function PATCH(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = (await req.json()) as Record<string, unknown>;
  const id = String(body.id ?? "");
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  // Pausing is a single-field update and skips the rest of the validation.
  if (typeof body.active === "boolean" && Object.keys(body).length === 2) {
    const { error } = await createAdminClient()
      .from("coupons")
      .update({ active: body.active })
      .eq("id", id)
      .eq("restaurant_id", actor.restaurantId);
    if (error) return await apiError("apiErr.promoUpdate", 500);
    return NextResponse.json({ ok: true });
  }

  const fields = readFields(body);
  if ("key" in fields) return await apiError(fields.key);

  const { error } = await createAdminClient()
    .from("coupons")
    .update({
      kind: fields.kind,
      value: fields.value,
      max_uses: fields.maxUses,
      min_subtotal: fields.minSubtotal,
      starts_at: fields.startsAt,
      ends_at: fields.endsAt,
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
    })
    .eq("id", id)
    // Scoped to the caller's restaurant so an id from elsewhere can't be edited.
    .eq("restaurant_id", actor.restaurantId);
  if (error) return await apiError("apiErr.promoUpdate", 500);
  return NextResponse.json({ ok: true });
}

// DELETE /api/coupons — remove a code. Past redemptions keep their record
// (coupon_id is ON DELETE SET NULL and the code text is copied onto the row).
export async function DELETE(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { id } = await req.json();
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  const { error } = await createAdminClient()
    .from("coupons")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId);
  if (error) return await apiError("apiErr.promoDelete", 500);
  return NextResponse.json({ ok: true });
}
