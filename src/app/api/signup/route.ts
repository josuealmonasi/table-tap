import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// POST /api/signup
// Body: { restaurantName, email, password }
// Creates a pre-confirmed auth user and their restaurant, atomically-ish:
// if the restaurant insert fails we remove the just-created user so a retry works.
export async function POST(req: NextRequest) {
  const { restaurantName, email, password } = await req.json();

  if (!restaurantName?.trim() || !email || !password || password.length < 6) {
    return NextResponse.json(
      { error: "Restaurant name, email and a 6+ character password are required." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Pre-confirm the email so there's no verification step for now.
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userErr || !created?.user) {
    return NextResponse.json(
      { error: userErr?.message ?? "Could not create the account." },
      { status: 400 },
    );
  }

  const { error: restaurantErr } = await admin
    .from("restaurants")
    .insert({ name: restaurantName.trim(), owner_id: created.user.id });

  if (restaurantErr) {
    // Roll back the orphaned user so the email is free to try again.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: restaurantErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
