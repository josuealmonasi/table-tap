import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { MANAGES } from "@/lib/membership";
import { isRoomLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeCode } from "@/lib/loyalty/code";
import { emailForRole, normalizeEmail, setCardEmail } from "@/lib/loyalty/card-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?code= — staff only: masked for the floor, full for owner and manager. */
export async function GET(req: NextRequest) {
  if (await isRoomLimited(req, "card-email-read", 60)) return await apiError("apiErr.tooManyRequests", 429);
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const code = normalizeCode(req.nextUrl.searchParams.get("code") ?? "");
  if (!code) return await apiError("rewards.invalid", 400);
  const { data, error } = await createAdminClient().from("loyalty_cards").select("email")
    .eq("restaurant_id", actor.restaurantId).eq("code", code).maybeSingle();
  if (error) return await apiError("apiErr.generic", 503);
  if (!data) return await apiError("apiErr.loyaltyNotHere", 404);
  return NextResponse.json({ email: emailForRole(data.email, MANAGES(actor.role)) });
}

/**
 * POST { code, email | null, consent } — link, replace or remove the card's
 * address. Staff of the card's restaurant, or the diner holding the card's
 * code (the code is the card: whoever holds it holds the card). Linking needs
 * the consent tick every time.
 */
export async function POST(req: NextRequest) {
  if (await isRoomLimited(req, "card-email", 20)) return await apiError("apiErr.tooManyRequests", 429);
  const body = await jsonBody<{ code?: unknown; email?: unknown; consent?: unknown }>(req);
  const code = normalizeCode(typeof body?.code === "string" ? body.code : "");
  if (!body || !code) return await apiError("rewards.invalid", 400);
  const removing = body.email === null || body.email === "";
  const email = removing ? null : normalizeEmail(body.email);
  if (!removing && !email) return await apiError("cardEmail.invalid", 400);
  if (email && body.consent !== true) return await apiError("cardEmail.consentNeeded", 400);
  try {
    const actor = await actingFrontOfHouse();
    let restaurantId = actor?.restaurantId;
    if (!restaurantId) {
      const { data } = await createAdminClient().from("loyalty_cards").select("restaurant_id").eq("code", code).maybeSingle();
      restaurantId = data?.restaurant_id as string | undefined;
    }
    if (!restaurantId) return await apiError("apiErr.loyaltyNotHere", 404);
    const result = await setCardEmail(restaurantId, code, email, actor?.email ?? "diner");
    if (result.outcome === "unknown") return await apiError("apiErr.loyaltyNotHere", 404);
    if (result.outcome === "taken") return NextResponse.json(result, { status: 409 });
    if (result.outcome === "saved") {
      return NextResponse.json({ outcome: "saved", email: actor ? emailForRole(result.email, MANAGES(actor.role)) : result.email });
    }
    return NextResponse.json(result);
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}
