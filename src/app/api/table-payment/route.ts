import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingStaff } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** How the waiter took the money, or that they didn't. */
type Settlement = "cash" | "card" | "written_off";

// POST /api/table-payment
// Body: { tableId, settlement }
//
// The waiter settles a table in person: cash, a card on their own terminal, or
// a write-off when nobody paid at all.
//
// Staff only, and scoped to the caller's own restaurant — this marks money as
// received without any money moving through us, so it is exactly the kind of
// thing that must not be reachable from a customer's phone.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { tableId, settlement } = (await req.json()) as {
    tableId?: string;
    settlement?: Settlement;
  };
  if (!tableId || !["cash", "card", "written_off"].includes(settlement ?? "")) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const db = createAdminClient();

  // Scoped by the actor's restaurant, so a table id from elsewhere matches
  // nothing. Only what is genuinely outstanding is touched: an order already
  // paid must not be quietly rewritten.
  const base = db
    .from("orders")
    .update(
      settlement === "written_off"
        ? // Not cancelled: the food went out and the kitchen spent it. Not
          // paid either, so it stays out of revenue — the debt is recorded as
          // abandoned rather than pretended away.
          { written_off: true }
        : { paid: true, pay_method: settlement },
    )
    .eq("restaurant_id", actor.restaurantId)
    .eq("table_id", tableId)
    .eq("paid", false)
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .neq("status", "cancelled");

  const { data: updated, error } = await base.select("id");
  if (error) return await apiError("apiErr.orderData", 500);
  if (!updated?.length) return await apiError("apiErr.billSettled", 409);

  // The table is settled, so any open request to settle it is answered.
  await db
    .from("service_requests")
    .update({ status: "done" })
    .eq("restaurant_id", actor.restaurantId)
    .eq("table_id", tableId)
    .eq("kind", "pay")
    .eq("status", "open");

  return NextResponse.json({ ok: true, orders: updated.length });
}
