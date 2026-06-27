import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// PATCH /api/orders  — update an order's status. Owner-only (RLS enforced
// because we use the user-scoped server client, not the admin client).
export async function PATCH(req: NextRequest) {
  const { id, status } = await req.json();

  const allowed = ["received", "preparing", "ready", "completed", "cancelled"];
  if (!id || !allowed.includes(status)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Confirm the order belongs to a restaurant this user owns.
  const { data: order } = await supabase
    .from("orders")
    .select("id, restaurant_id, restaurants(owner_id)")
    .eq("id", id)
    .single();

  const rel = (order as { restaurants?: { owner_id?: string } | { owner_id?: string }[] } | null)
    ?.restaurants;
  const ownerId = Array.isArray(rel) ? rel[0]?.owner_id : rel?.owner_id;

  if (!order || ownerId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase.from("orders").update({ status }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
