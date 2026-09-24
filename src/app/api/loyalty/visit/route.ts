import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingManager } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { localToday } from "@/lib/loyalty/day";

export const runtime = "nodejs";

// DELETE /api/loyalty/visit  { id } — take back a stamp given by mistake.
//
// A manager's, and only today's: the card scanned twice at the wrong table,
// the waiter who stamped a card with nothing sold. Yesterday's visit is part of
// the record a reward was earned on, and unpicking it later would let the
// count be rewritten after the fact — and so is today's, once a reward has
// been spent after it: taking it back then left the card owing a visit.
// Written in the activity log like the stamp it undoes.
export async function DELETE(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{ id?: unknown }>(req);
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();
  const [{ data: visit }, { data: restaurant }] = await Promise.all([
    db.from("loyalty_visits").select("visit_day, actor_email")
      .eq("id", id).eq("restaurant_id", actor.restaurantId).maybeSingle(),
    db.from("restaurants").select("timezone").eq("id", actor.restaurantId).single(),
  ]);
  if (!visit) return await apiError("apiErr.loyaltyVisitGone", 404);

  // Decided in the database, under the card's lock: the day, and whether a
  // reward has been spent since — an undo racing a redemption must not win.
  const { data: outcome, error } = await db.rpc("loyalty_unstamp", {
    p_restaurant: actor.restaurantId,
    p_visit: id,
    p_today: localToday(restaurant?.timezone ?? null),
  });
  if (error) {
    console.error("loyalty visit undo failed:", error.message);
    return await apiError("apiErr.generic", 500);
  }
  if (outcome === "gone") return await apiError("apiErr.loyaltyVisitGone", 404);
  if (outcome === "old") return await apiError("apiErr.loyaltyVisitOld", 409);
  if (outcome === "spent") return await apiError("apiErr.loyaltyVisitSpent", 409);
  if (outcome !== "done") {
    console.error("loyalty visit undo answered", outcome);
    return await apiError("apiErr.generic", 500);
  }

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "loyalty",
    action: "deleted",
    detail: logDetail({ visit: visit.visit_day, stampedBy: visit.actor_email }),
  });
  return NextResponse.json({ ok: true });
}
