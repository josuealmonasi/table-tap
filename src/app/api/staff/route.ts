import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** The caller's own restaurant id — or null if they don't own one. */
async function ownedRestaurantId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_id", user.id)
    .single();
  return data?.id ?? null;
}

// POST /api/staff — the owner creates a staff login (orders board only).
// The auth user is created with the secret key; a matching staff row links it
// to the owner's restaurant.
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (typeof password !== "string" || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const restaurantId = await ownedRestaurantId();
  if (!restaurantId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !created.user) {
    return NextResponse.json(
      { error: userErr?.message ?? "Could not create the login." },
      { status: 400 }
    );
  }

  const { error: staffErr } = await admin.from("staff").insert({
    restaurant_id: restaurantId,
    user_id: created.user.id,
    email,
  });
  if (staffErr) {
    await admin.auth.admin.deleteUser(created.user.id); // roll back the login
    return NextResponse.json({ error: "Could not add the staff member." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/staff — the owner removes a staff login entirely (the staff row
// cascades away with the auth user).
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const restaurantId = await ownedRestaurantId();
  if (!restaurantId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("staff")
    .select("id, user_id, restaurant_id")
    .eq("id", id)
    .single();
  if (!member || member.restaurant_id !== restaurantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error } = await admin.auth.admin.deleteUser(member.user_id);
  if (error) return NextResponse.json({ error: "Could not remove the login." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
