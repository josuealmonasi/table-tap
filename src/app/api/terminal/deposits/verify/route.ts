import { NextRequest, NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

/** Only a checked bank receipt can supply a currency the old writer omitted. */
export async function POST(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: unknown; currency?: unknown; confirmed?: unknown; reason?: unknown }>(req);
  if (!body || typeof body.id !== "string" || (body.currency !== "MXN" && body.currency !== "USD") || body.confirmed !== true
    || typeof body.reason !== "string" || body.reason.trim().length < 8 || body.reason.length > 500) return await apiError("apiErr.invalidRequest", 400);
  const { data, error } = await createAdminClient().from("terminal_deposits").update({ currency: body.currency })
    .eq("restaurant_id", actor.restaurantId).eq("id", body.id).is("currency", null).select("id, sales_day");
  if (error?.code === "23505") return await apiError("apiErr.depositMarked", 409);
  if (error) return await apiError("apiErr.generic", 500);
  if (!data?.length) return await apiError("apiErr.notFound", 404);
  await logEvent({ restaurantId: actor.restaurantId, actor: actor.email, entity: "terminal", action: "approved",
    detail: logDetail({ note: `${data[0].sales_day}: ${body.currency}: ${body.reason.trim()}`, currency: body.currency }) });
  return NextResponse.json({ ok: true });
}
