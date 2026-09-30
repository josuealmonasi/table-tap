import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { actingOwner } from "@/lib/api-guard";
import { frozenBlocks, seatBlocks } from "@/lib/plan-guard";
import { logUserChange } from "@/lib/user-log";
import { getPlan, allPlans } from "@/lib/plan-server";
import { assignableRoles, cheapestWith, planLabel, type TeamRole } from "@/lib/plan";

export const runtime = "nodejs";

const ROLES: readonly string[] = ["owner", "manager", "waiter", "cashier", "kitchen"];

/** Owners a restaurant may have, counting the founding owner. */
const MAX_OWNERS = 3;

/** True when adding one more owner login would pass the cap. */
async function ownerSlotFree(restaurantId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: r } = await admin
    .from("restaurants")
    .select("owner_id")
    .eq("id", restaurantId)
    .single();
  const { count } = await admin
    .from("staff")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .eq("role", "owner");
  return (r?.owner_id ? 1 : 0) + (count ?? 0) < MAX_OWNERS;
}

// POST /api/staff — an owner invites a team member (owner / manager / waiter /
// kitchen). We email them an invite link to set their own password, so the
// owner never handles someone else's credentials.
export async function POST(req: NextRequest) {
  // Who is asking, before what they sent. The address was checked first, so
  // the only request the roles gate could use to prove an owner gets past the
  // role check was a well-formed address — one that already had an account,
  // so Supabase would refuse to invite it. That made every roles:prod run ask
  // production to invite somebody, and kept it harmless only as long as the
  // account stayed there and stayed confirmed.
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{ email?: string; role?: string }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { email, role } = body;

  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
    return await apiError("apiErr.email", 400);
  }
  if (!role || !ROLES.includes(role)) {
    return await apiError("apiErr.pickRole", 400);
  }

  // Every invited login is a seat, whatever its role. One pool rather than a
  // quota per role: an owner who needs a fourth waiter should not be told they
  // have two kitchen seats free.
  const { count: seatsUsed } = await createAdminClient()
    .from("staff")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", actor.restaurantId);
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;

  // A role the tier has no screen for is refused before the seats are
  // counted: "Caja has no kitchen board" is the answer to a cook, and "you
  // are out of seats" would send the owner to buy a seat for a login that
  // still could not sign in to anything.
  const roleRefused = await roleBlocks(actor.restaurantId, role);
  if (roleRefused) return roleRefused;

  const noSeat = await seatBlocks(actor.restaurantId, seatsUsed ?? 0);
  if (noSeat) return noSeat;

  if (role === "owner" && !(await ownerSlotFree(actor.restaurantId))) {
    return await apiError("apiErr.ownerCap", 409, { n: MAX_OWNERS });
  }

  const admin = createAdminClient();
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;

  // Creates the (password-less) user and emails them an invite. They set their
  // own password via the link → /auth/callback → /reset-password.
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: `${origin}/auth/callback?next=/reset-password` },
  );
  if (inviteErr || !invited.user) {
    const raw = inviteErr?.message?.toLowerCase() ?? "";
    const already = raw.includes("already");
    // Supabase says "invalid" or "rate limit" when it is the one that cannot send
    // the mail, not when the address is wrong. Telling the owner their waiter's
    // email is invalid sends them to check the one thing that is actually fine.
    const mailer = raw.includes("rate limit") || raw.includes("invalid");
    console.error("staff invite failed", inviteErr?.message);
    return await apiError(
      already ? "apiErr.emailHasAccount" : mailer ? "apiErr.inviteMailerOff" : "apiErr.inviteFailed",
      400,
    );
  }

  const { error: staffErr } = await admin.from("staff").insert({
    restaurant_id: actor.restaurantId,
    user_id: invited.user.id,
    email,
    role,
  });
  if (staffErr) {
    await admin.auth.admin.deleteUser(invited.user.id); // roll back the invite
    return await apiError("apiErr.staffAdd", 500);
  }

  await logUserChange(actor.restaurantId, actor.email, "created", role, email);
  return NextResponse.json({ ok: true });
}

// PATCH /api/staff — an owner changes a member's role.
export async function PATCH(req: NextRequest) {
  const body = await jsonBody<{ id?: string; role?: string }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { id, role } = body;
  if (!id || !role || !ROLES.includes(role)) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("staff")
    .select("id, email, role, restaurant_id")
    .eq("id", id)
    .single();
  if (!member || member.restaurant_id !== actor.restaurantId) {
    return await apiError("apiErr.notFound", 404);
  }
  if (member.role === role) return NextResponse.json({ ok: true });
  const roleRefused = await roleBlocks(actor.restaurantId, role);
  if (roleRefused) return roleRefused;

  if (role === "owner" && !(await ownerSlotFree(actor.restaurantId))) {
    return await apiError("apiErr.ownerCap", 409, { n: MAX_OWNERS });
  }

  const { error } = await admin.from("staff").update({ role }).eq("id", id);
  if (error) return await apiError("apiErr.staffRole", 500);

  await logUserChange(actor.restaurantId, actor.email, "updated", role, member.email);
  return NextResponse.json({ ok: true });
}

// DELETE /api/staff — an owner removes a login entirely (the staff row
// cascades away with the auth user).
export async function DELETE(req: NextRequest) {
  const body = await jsonBody<{ id?: string }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { id } = body;
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("staff")
    .select("id, user_id, email, role, restaurant_id")
    .eq("id", id)
    .single();
  if (!member || member.restaurant_id !== actor.restaurantId) {
    return await apiError("apiErr.notFound", 404);
  }

  const { error } = await admin.auth.admin.deleteUser(member.user_id);
  if (error) return await apiError("apiErr.loginRemove", 500);

  await logUserChange(actor.restaurantId, actor.email, "deleted", member.role, member.email);
  return NextResponse.json({ ok: true });
}

/**
 * A role this restaurant's tier has no screen for — a cook or a waiter on
 * Caja — refused with the tier that has one, the same list the team screen
 * offers (`assignableRoles`).
 */
async function roleBlocks(restaurantId: string, role: string): Promise<NextResponse | null> {
  const plan = await getPlan(restaurantId);
  if (assignableRoles(plan?.limits).includes(role as TeamRole)) return null;
  const unlocks = cheapestWith(await allPlans(), "kitchenBoard", plan?.limits);
  return await apiError("plan.needs.kitchenBoard", 403, { plan: planLabel(unlocks?.plan ?? "servicio") });
}
