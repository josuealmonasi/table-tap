import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// PATCH /api/orders  — update an order's status. Owner-only (RLS enforced
// because we use the user-scoped server client, not the admin client).
export async function PATCH(req: NextRequest) {
  const { id, status } = await req.json();

  // "cancelled" is deliberately NOT here: cancelling must go through
  // /api/orders/cancel so a paid order is always refunded first.
  const allowed = ["received", "preparing", "ready", "completed"];
  if (!id || !allowed.includes(status)) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return await apiError("apiErr.unauthorized", 401);

  // Authorisation is the RLS read itself: only the owner and their staff can
  // SELECT an order (works_at policy), so seeing it means they may advance it.
  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("id", id)
    .single();
  if (!order) {
    return await apiError("apiErr.forbidden", 403);
  }

  // Ownership is verified above. Orders have no client UPDATE policy (writes are
  // server-only), so perform the update with the secret key.
  const { error } = await createAdminClient()
    .from("orders")
    .update({ status })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
