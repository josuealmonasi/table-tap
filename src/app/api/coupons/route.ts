import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMembership, MANAGES } from "@/lib/membership";
import { isValidCouponFormat, normalizeCoupon } from "@/lib/coupons";

export const runtime = "nodejs";

// Coupon management for owners and managers. Writes go through the secret key
// after the role check, matching /api/settings — managers have no direct RLS
// write path of their own to rely on.

interface Actor {
  restaurantId: string;
  email: string;
}

async function actingManager(): Promise<Actor | null> {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership || !MANAGES(membership.role)) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { restaurantId: membership.restaurant.id, email: user?.email ?? "staff" };
}

/** Validates and normalises the editable fields shared by POST and PATCH. */
function readFields(body: Record<string, unknown>) {
  const kind = body.kind === "fixed" ? "fixed" : "percent";
  const value = Number(body.value);
  if (!Number.isFinite(value) || value <= 0) return { error: "Enter an amount above 0." };
  if (kind === "percent" && value > 100) {
    return { error: "A percentage can't be above 100." };
  }

  const rawMax = body.maxUses;
  const maxUses =
    rawMax === null || rawMax === undefined || rawMax === ""
      ? null
      : Math.floor(Number(rawMax));
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1)) {
    return { error: "Uses must be 1 or more, or left empty for unlimited." };
  }

  const minSubtotal = Math.max(0, Number(body.minSubtotal) || 0);
  return { kind, value, maxUses, minSubtotal };
}

// POST /api/coupons — create a code.
export async function POST(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as Record<string, unknown>;
  const code = normalizeCoupon(String(body.code ?? ""));
  if (!isValidCouponFormat(code)) {
    return NextResponse.json({ error: "That code isn't the right shape." }, { status: 400 });
  }

  const fields = readFields(body);
  if ("error" in fields) return NextResponse.json(fields, { status: 400 });

  const { error } = await createAdminClient().from("coupons").insert({
    restaurant_id: actor.restaurantId,
    code,
    kind: fields.kind,
    value: fields.value,
    max_uses: fields.maxUses,
    min_subtotal: fields.minSubtotal,
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
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as Record<string, unknown>;
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  // Pausing is a single-field update and skips the rest of the validation.
  if (typeof body.active === "boolean" && Object.keys(body).length === 2) {
    const { error } = await createAdminClient()
      .from("coupons")
      .update({ active: body.active })
      .eq("id", id)
      .eq("restaurant_id", actor.restaurantId);
    if (error) return NextResponse.json({ error: "Could not update." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const fields = readFields(body);
  if ("error" in fields) return NextResponse.json(fields, { status: 400 });

  const { error } = await createAdminClient()
    .from("coupons")
    .update({
      kind: fields.kind,
      value: fields.value,
      max_uses: fields.maxUses,
      min_subtotal: fields.minSubtotal,
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
    })
    .eq("id", id)
    // Scoped to the caller's restaurant so an id from elsewhere can't be edited.
    .eq("restaurant_id", actor.restaurantId);
  if (error) return NextResponse.json({ error: "Could not update." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/coupons — remove a code. Past redemptions keep their record
// (coupon_id is ON DELETE SET NULL and the code text is copied onto the row).
export async function DELETE(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { error } = await createAdminClient()
    .from("coupons")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId);
  if (error) return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
