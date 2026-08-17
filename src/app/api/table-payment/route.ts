import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

export const runtime = "nodejs";

/** How the waiter took the money, or that they didn't. */
type Settlement = "cash" | "card" | "written_off";

// POST /api/table-payment
// Body: { tableId, settlement }
//
// The waiter settles a table in person: cash, a card on their own terminal, or
// a write-off when nobody paid at all.
//
// Front of house only — owner, manager or waiter — and scoped to the caller's
// own restaurant. This marks money as received without any money moving
// through us, so it must not be reachable from a customer's phone, nor from a
// kitchen screen that everyone in the back has their hands on.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
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

  const { data: updated, error } = await base.select("id, table_label, total");
  if (error) return await apiError("apiErr.orderData", 500);
  if (!updated?.length) return await apiError("apiErr.nothingToSettle", 409);

  // Money moved without a card, so it is worth being able to ask about later.
  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "bill",
    action: settlement === "written_off" ? "written_off" : "paid",
    detail: logDetail({
      table: updated[0].table_label,
      orders: updated.length,
      amount: updated.reduce((sum, o) => sum + Number(o.total), 0).toFixed(2),
      method: settlement === "written_off" ? null : settlement,
    }),
  });

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
