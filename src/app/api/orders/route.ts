import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MOVES_ORDERS } from "@/lib/membership";
import { actingStaff } from "@/lib/api-guard";

export const runtime = "nodejs";

// PATCH /api/orders  — update an order's status. Owner-only (RLS enforced
// because we use the user-scoped server client, not the admin client).
export async function PATCH(req: NextRequest) {
  const { id, status, from } = await req.json();

  // "cancelled" is deliberately NOT here: cancelling must go through
  // /api/orders/cancel so a paid order is always refunded first.
  const allowed = ["received", "preparing", "ready", "completed"];
  if (!id || !allowed.includes(status)) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const supabase = await createClient();

  // A waiter may only close out an order they're handing over. Every other
  // stage change belongs to the kitchen, and the UI hiding the control is not
  // enforcement — this is.
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  if (!MOVES_ORDERS(actor.role) && status !== "completed") {
    return await apiError("apiErr.notYourStage", 403);
  }

  // Authorisation is otherwise the RLS read itself: only the owner and their
  // staff can SELECT an order (works_at policy), so seeing it means they may
  // advance it.
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
  //
  // `from` is sent by a move that waited out a dropped connection, and it makes
  // the write a compare-and-set: apply it only if nothing has happened to the
  // order since. Without it a waiter's queued "preparing", flushed on
  // reconnect, would drag back an order the kitchen has already called ready —
  // stale work quietly beating live work, which is the whole risk of holding
  // anything offline. A live move sends no `from` and overwrites as it always
  // did.
  const write = createAdminClient().from("orders").update({ status }).eq("id", id);
  const { data: moved, error } = await (typeof from === "string"
    ? write.eq("status", from)
    : write
  ).select("id");
  if (error) return await apiError("apiErr.orderData", 500);

  // Nothing matched, and the order exists: somebody else got there first. Not
  // an error — the board is simply newer than the tap that has been waiting.
  if (typeof from === "string" && moved?.length === 0) {
    return NextResponse.json({ ok: false, superseded: true });
  }

  return NextResponse.json({ ok: true });
}
