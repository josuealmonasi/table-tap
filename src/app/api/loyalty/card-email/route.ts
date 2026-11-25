import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { MANAGES } from "@/lib/membership";
import { clientKey, isRateLimited, isRoomLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeCode } from "@/lib/loyalty/code";
import { cardEmailPending, emailForRole, normalizeEmail, setCardEmail } from "@/lib/loyalty/card-email";
import { sendCardEmailConfirmation } from "@/lib/loyalty/card-email-confirmation";
import { hashOwnerSecret, matchesOwnerSecret, readOwnerSecret } from "@/lib/loyalty/owner-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diner address changes per hour from one network address, across every card. */
const DINER_LINKS_PER_ADDRESS = 20;

/** GET ?code= — staff only: masked for the floor, full for owner and manager. */
export async function GET(req: NextRequest) {
  if (await isRoomLimited(req, "card-email-read", 60)) return await apiError("apiErr.tooManyRequests", 429);
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const code = normalizeCode(req.nextUrl.searchParams.get("code") ?? "");
  if (!code) return await apiError("rewards.invalid", 400);
  const { data, error } = await createAdminClient().from("loyalty_cards").select("email, pending_email_expires_at")
    .eq("restaurant_id", actor.restaurantId).eq("code", code).maybeSingle();
  if (error) return await apiError("apiErr.generic", 503);
  if (!data) return await apiError("apiErr.loyaltyNotHere", 404);
  return NextResponse.json({ email: emailForRole(data.email, MANAGES(actor.role)), pending: cardEmailPending(data.pending_email_expires_at) });
}

/**
 * POST { code, email | null, consent } — link, replace or remove the card's
 * address. Staff of the card's restaurant or the phone holding its secret
 * can make the request. A new address activates only after inbox confirmation.
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
    const secret = actor ? null : readOwnerSecret(req, code);
    if (!actor) {
      if (!secret) return await apiError("cardEmail.ownerRequired", 403);
      const { data, error } = await createAdminClient().from("loyalty_cards").select("owner_secret_hash").eq("code", code).maybeSingle();
      if (error) return await apiError("apiErr.generic", 503);
      if (!data) return await apiError("apiErr.loyaltyNotHere", 404);
      if (!matchesOwnerSecret(secret, data.owner_secret_hash)) return await apiError("cardEmail.ownerRequired", 403);
      // Only linking uses these hourly allowances. Authorization comes first
      // so a person with the printed code cannot spend the owner's allowance.
      if (!removing && (await isRateLimited(`card-email:${code}`, 5, 3600)
        || await isRateLimited(`card-email-diner:${clientKey(req)}`, DINER_LINKS_PER_ADDRESS, 3600))) {
        return await apiError("apiErr.tooManyRequests", 429);
      }
    }
    const result = await setCardEmail(code, email, actor
      ? { restaurantId: actor.restaurantId, actor: actor.email }
      : { ownerHash: hashOwnerSecret(secret!) });
    if (result.outcome === "unknown") return await apiError("apiErr.loyaltyNotHere", 404);
    if (result.outcome === "forbidden") return await apiError("cardEmail.ownerRequired", 403);
    if (result.outcome === "submitted" && email) {
      await sendCardEmailConfirmation(req, code, email, result.token);
    }
    if (result.outcome === "saved") {
      return NextResponse.json({ outcome: "saved", email: emailForRole(result.email, Boolean(actor && MANAGES(actor.role))) });
    }
    return NextResponse.json({ outcome: result.outcome === "removed" ? "removed" : "submitted" });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}
