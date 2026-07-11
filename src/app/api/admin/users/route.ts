import { NextRequest, NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ROLES: readonly string[] = ["admin", "owner", "manager", "kitchen"];
const MAX_OWNERS = 3;

/** Restaurant-scoped actions also land in that restaurant's activity log. */
async function log(
  restaurantId: string,
  actorEmail: string,
  action: "created" | "deleted",
  targetRole: string,
  targetEmail: string
): Promise<void> {
  await createAdminClient().from("user_logs").insert({
    restaurant_id: restaurantId,
    actor_email: actorEmail,
    action,
    target_role: targetRole,
    target_email: targetEmail,
  });
}

// POST /api/admin/users — a platform admin creates any kind of login:
// another admin, a founding owner (with a new restaurant), or a team member
// (owner/manager/kitchen) of an existing restaurant.
export async function POST(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { email, password, role, restaurantId, restaurantName } = await req.json();
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: "Pick a role." }, { status: 400 });
  }
  if (role !== "admin" && !restaurantId && !(role === "owner" && restaurantName?.trim())) {
    return NextResponse.json({ error: "Pick a restaurant (or name a new one for an owner)." }, { status: 400 });
  }

  const db = createAdminClient();

  // Owner cap applies when attaching a co-owner to an existing restaurant.
  if (role === "owner" && restaurantId) {
    const { data: r } = await db.from("restaurants").select("owner_id").eq("id", restaurantId).single();
    const { count } = await db
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("role", "owner");
    if ((r?.owner_id ? 1 : 0) + (count ?? 0) >= MAX_OWNERS) {
      return NextResponse.json({ error: `That restaurant already has ${MAX_OWNERS} owners.` }, { status: 409 });
    }
  }

  const { data: created, error: userErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !created.user) {
    return NextResponse.json({ error: userErr?.message ?? "Could not create the login." }, { status: 400 });
  }

  try {
    if (role === "admin") {
      const { error } = await db.from("platform_admins").insert({ user_id: created.user.id, email });
      if (error) throw error;
    } else if (role === "owner" && !restaurantId) {
      const { error } = await db
        .from("restaurants")
        .insert({ name: restaurantName.trim(), owner_id: created.user.id });
      if (error) throw error;
    } else {
      const { error } = await db.from("staff").insert({
        restaurant_id: restaurantId,
        user_id: created.user.id,
        email,
        role,
      });
      if (error) throw error;
      await log(restaurantId, admin.email, "created", role, email);
    }
  } catch {
    await db.auth.admin.deleteUser(created.user.id); // roll back the login
    return NextResponse.json({ error: "Could not attach the new login." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/users — a platform admin removes any login. Founding
// owners must have their restaurant deleted (or transferred) first.
export async function DELETE(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (userId === admin.userId) {
    return NextResponse.json({ error: "You can't delete your own admin login." }, { status: 409 });
  }

  const db = createAdminClient();

  const { data: owned } = await db.from("restaurants").select("id, name").eq("owner_id", userId).single();
  if (owned) {
    return NextResponse.json(
      { error: `This user founded "${owned.name}" — delete that restaurant first.` },
      { status: 409 }
    );
  }

  // Capture staff membership before it cascades away, so we can log it.
  const { data: member } = await db
    .from("staff")
    .select("restaurant_id, email, role")
    .eq("user_id", userId)
    .single();

  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: "Could not delete the login." }, { status: 500 });

  if (member) await log(member.restaurant_id, admin.email, "deleted", member.role, member.email);
  return NextResponse.json({ ok: true });
}
