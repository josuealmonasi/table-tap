import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { isRoomLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * POST { token } — the "stop sending me tickets" link in every ticket email.
 * Removes the address from the card (and the consent with it). A POST from a
 * button, never on opening the link: mail scanners open links.
 */
export async function POST(req: NextRequest) {
  if (await isRoomLimited(req, "tickets-stop", 20)) return await apiError("apiErr.tooManyRequests", 429);
  const body = await jsonBody<{ token?: unknown }>(req);
  const token = typeof body?.token === "string" && uuid.test(body.token) ? body.token : null;
  if (!token) return await apiError("apiErr.invalidRequest", 400);
  const db = createAdminClient();
  const { data, error } = await db.from("loyalty_cards")
    .update({ email: null, email_consent_at: null, email_notice_version: null, email_set_by: null, email_unsubscribe: null })
    .eq("email_unsubscribe", token).select("restaurant_id").maybeSingle();
  if (error) return await apiError("apiErr.generic", 503);
  if (!data) return await apiError("cardEmail.stopGone", 404);
  const { data: r } = await db.from("restaurants").select("name").eq("id", data.restaurant_id).maybeSingle();
  return NextResponse.json({ restaurant: r?.name ?? "" });
}
