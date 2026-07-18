import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ROLES: readonly string[] = ["owner", "manager", "waiter", "kitchen"];

/** Owners a restaurant may have, counting the founding owner. */
const MAX_OWNERS = 3;

interface Actor {
  restaurantId: string;
  email: string;
}

/** The caller as an owner (founding or co-owner) — null when they're neither. */
async function actingOwner(): Promise<Actor | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: owned } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_id", user.id)
    .single();
  if (owned) return { restaurantId: owned.id, email: user.email ?? "owner" };

  const { data: co } = await supabase
    .from("staff")
    .select("restaurant_id, role")
    .eq("user_id", user.id)
    .single();
  if (co?.role === "owner")
    return { restaurantId: co.restaurant_id, email: user.email ?? "owner" };
  return null;
}

/** Every user-management action lands in the restaurant's activity log. */
async function log(
  restaurantId: string,
  actorEmail: string,
  action: "created" | "updated" | "deleted",
  targetRole: string,
  targetEmail: string,
): Promise<void> {
  await createAdminClient().from("user_logs").insert({
    restaurant_id: restaurantId,
    actor_email: actorEmail,
    action,
    target_role: targetRole,
    target_email: targetEmail,
  });
}

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
  const { email, role } = await req.json();

  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "Pick a role." }, { status: 400 });
  }

  const actor = await actingOwner();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (role === "owner" && !(await ownerSlotFree(actor.restaurantId))) {
    return NextResponse.json(
      { error: `A restaurant can have at most ${MAX_OWNERS} owners.` },
      { status: 409 },
    );
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
    const already = inviteErr?.message?.toLowerCase().includes("already");
    return NextResponse.json(
      {
        error: already
          ? "That email already has an account."
          : (inviteErr?.message ?? "Could not send the invite."),
      },
      { status: 400 },
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
    return NextResponse.json(
      { error: "Could not add the team member." },
      { status: 500 },
    );
  }

  await log(actor.restaurantId, actor.email, "created", role, email);
  return NextResponse.json({ ok: true });
}

// PATCH /api/staff — an owner changes a member's role.
export async function PATCH(req: NextRequest) {
  const { id, role } = await req.json();
  if (!id || !ROLES.includes(role)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const actor = await actingOwner();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("staff")
    .select("id, email, role, restaurant_id")
    .eq("id", id)
    .single();
  if (!member || member.restaurant_id !== actor.restaurantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (member.role === role) return NextResponse.json({ ok: true });

  if (role === "owner" && !(await ownerSlotFree(actor.restaurantId))) {
    return NextResponse.json(
      { error: `A restaurant can have at most ${MAX_OWNERS} owners.` },
      { status: 409 },
    );
  }

  const { error } = await admin.from("staff").update({ role }).eq("id", id);
  if (error)
    return NextResponse.json({ error: "Could not update the role." }, { status: 500 });

  await log(actor.restaurantId, actor.email, "updated", role, member.email);
  return NextResponse.json({ ok: true });
}

// DELETE /api/staff — an owner removes a login entirely (the staff row
// cascades away with the auth user).
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const actor = await actingOwner();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("staff")
    .select("id, user_id, email, role, restaurant_id")
    .eq("id", id)
    .single();
  if (!member || member.restaurant_id !== actor.restaurantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await admin.auth.admin.deleteUser(member.user_id);
  if (error)
    return NextResponse.json({ error: "Could not remove the login." }, { status: 500 });

  await log(actor.restaurantId, actor.email, "deleted", member.role, member.email);
  return NextResponse.json({ ok: true });
}
