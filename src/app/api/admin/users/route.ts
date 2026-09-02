import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ROLES: readonly string[] = ["admin", "owner", "manager", "waiter", "cashier", "kitchen"];
const MAX_OWNERS = 3;

/** Restaurant-scoped actions also land in that restaurant's activity log. */
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

// POST /api/admin/users — a platform admin creates any kind of login:
// another admin, a founding owner (with a new restaurant), or a team member
// (owner/manager/kitchen) of an existing restaurant.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);

  const { email, password, role, restaurantId, restaurantName } = await req.json();
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
    return await apiError("apiErr.email", 400);
  }
  if (typeof password !== "string" || password.length < 8) {
    return await apiError("apiErr.password8", 400);
  }
  if (!ROLES.includes(role)) {
    return await apiError("apiErr.pickRole", 400);
  }
  if (
    role !== "admin" &&
    !restaurantId &&
    !(role === "owner" && restaurantName?.trim())
  ) {
    return await apiError("apiErr.pickRestaurant", 400);
  }

  const db = createAdminClient();

  // Owner cap applies when attaching a co-owner to an existing restaurant.
  if (role === "owner" && restaurantId) {
    const { data: r } = await db
      .from("restaurants")
      .select("owner_id")
      .eq("id", restaurantId)
      .single();
    const { count } = await db
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("role", "owner");
    if ((r?.owner_id ? 1 : 0) + (count ?? 0) >= MAX_OWNERS) {
      return await apiError("apiErr.ownerCap", 409, { n: MAX_OWNERS });
    }
  }

  const { data: created, error: userErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !created.user) {
    if (userErr?.message) {
      return NextResponse.json({ error: userErr.message }, { status: 400 });
    }
    return await apiError("apiErr.loginCreate", 400);
  }

  try {
    if (role === "admin") {
      const { error } = await db
        .from("platform_admins")
        .insert({ user_id: created.user.id, email });
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
    return await apiError("apiErr.loginAttach", 500);
  }

  return NextResponse.json({ ok: true });
}

// PATCH /api/admin/users — a platform admin edits a login: name, email, a
// password reset (sets a NEW one; the old is never readable), and — for team
// members — the role. Founding-owner and admin roles can't be changed here.
export async function PATCH(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);

  const { userId, fullName, email, password, role } = await req.json();
  if (!userId) return await apiError("apiErr.invalidRequest", 400);
  if (email !== undefined && !/^\S+@\S+\.\S+$/.test(email)) {
    return await apiError("apiErr.email", 400);
  }
  if (password !== undefined && (typeof password !== "string" || password.length < 8)) {
    return await apiError("apiErr.newPassword8", 400);
  }
  if (role !== undefined && !["owner", "manager", "waiter", "cashier", "kitchen"].includes(role)) {
    return await apiError("apiErr.pickValidRole", 400);
  }

  const db = createAdminClient();
  const { data: member } = await db
    .from("staff")
    .select("id, restaurant_id, email, role")
    .eq("user_id", userId)
    .single();

  // Role changes only make sense for team members (a founding owner's or
  // admin's role isn't a staff row).
  if (role !== undefined && !member) {
    return await apiError("apiErr.teamRolesOnly", 400);
  }
  if (role === "owner" && member && member.role !== "owner") {
    const { data: r } = await db
      .from("restaurants")
      .select("owner_id")
      .eq("id", member.restaurant_id)
      .single();
    const { count } = await db
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", member.restaurant_id)
      .eq("role", "owner");
    if ((r?.owner_id ? 1 : 0) + (count ?? 0) >= MAX_OWNERS) {
      return await apiError("apiErr.ownerCap", 409, { n: MAX_OWNERS });
    }
  }

  // Auth-side updates (email / new password) — Supabase handles the secrets.
  if (email !== undefined || password !== undefined) {
    const { error } = await db.auth.admin.updateUserById(userId, {
      ...(email !== undefined ? { email, email_confirm: true } : {}),
      ...(password !== undefined ? { password } : {}),
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  if (fullName !== undefined) {
    const { error } = await db.from("profiles").upsert({
      user_id: userId,
      full_name: String(fullName).trim(),
      updated_at: new Date().toISOString(),
    });
    if (error) return await apiError("apiErr.nameSave", 500);
  }

  // Keep the denormalised emails + role in sync.
  if (member) {
    const changes: Record<string, string> = {};
    if (email !== undefined) changes.email = email;
    if (role !== undefined && role !== member.role) changes.role = role;
    if (Object.keys(changes).length > 0) {
      const { error } = await db.from("staff").update(changes).eq("id", member.id);
      if (error) return await apiError("apiErr.staffRow", 500);
    }
    await log(
      member.restaurant_id,
      admin.email,
      "updated",
      role ?? member.role,
      email ?? member.email,
    );
  }
  if (email !== undefined) {
    await db.from("platform_admins").update({ email }).eq("user_id", userId);
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/users — a platform admin removes any login. Founding
// owners must have their restaurant deleted (or transferred) first.
export async function DELETE(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);

  const { userId } = await req.json();
  // Shape-checked before it reaches Postgres: a malformed id threw inside the
  // uuid comparison and the route answered 500 with an empty body, which tells
  // the admin screen nothing it can show.
  if (typeof userId !== "string" || !UUID.test(userId)) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  if (userId === admin.userId) {
    return await apiError("apiErr.ownAdminLogin", 409);
  }

  const db = createAdminClient();

  const { data: owned } = await db
    .from("restaurants")
    .select("id, name")
    .eq("owner_id", userId)
    .single();
  if (owned) {
    return await apiError("apiErr.foundedRestaurant", 409, { name: owned.name });
  }

  // Capture staff membership before it cascades away, so we can log it.
  const { data: member } = await db
    .from("staff")
    .select("restaurant_id, email, role")
    .eq("user_id", userId)
    .single();

  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) return await apiError("apiErr.loginDelete", 500);

  if (member)
    await log(member.restaurant_id, admin.email, "deleted", member.role, member.email);
  return NextResponse.json({ ok: true });
}
