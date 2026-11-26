import { after, NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { requestLocale } from "@/lib/i18n";
import { jsonBody } from "@/lib/json-body";
import { TERMS_VERSION } from "@/lib/legal";
import { newSignupToken, signupHash } from "@/lib/pending-signup";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { cleanRestaurantName, RESTAURANT_NAME_MAX } from "@/lib/restaurant-name";
import { sendSignupMail } from "@/lib/signup-confirmation";
import { isSignupMailCapped } from "@/lib/signup-mail-ceiling";
import { createAdminClient } from "@/lib/supabase/admin";
import { TERMS_TEXT_HASH } from "@/lib/terms-evidence";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`signup:${clientKey(req)}`, 5, 60)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const body = await jsonBody<{ restaurantName?: unknown; email?: unknown; acceptedTerms?: unknown }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  if (body.acceptedTerms !== true) return await apiError("auth.termsRequired", 400);
  const typedName = typeof body.restaurantName === "string" ? body.restaurantName.trim() : "";
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!typedName || !isValidEmail(email)) return await apiError("apiErr.signupFields", 400);
  const restaurantName = cleanRestaurantName(typedName);
  if (!restaurantName) return await apiError("apiErr.restaurantNameLength", 400, { n: RESTAURANT_NAME_MAX });
  // Over the inbox's ceiling: the same answer, and nothing stored or sent.
  if (await isSignupMailCapped(email)) return NextResponse.json({ ok: true, pendingVerification: true });

  const token = newSignupToken();
  // v2 also releases an unconfirmed login nobody vouches for (one made by
  // calling Auth's public signup directly), so it cannot squat the address.
  const locale = requestLocale(req);
  const { data: existing, error } = await createAdminClient().rpc("request_pending_signup_v2", {
    p_email: email,
    p_token_hash: signupHash(token),
    p_restaurant_name: restaurantName,
    p_locale: locale,
    p_terms_version: TERMS_VERSION,
    p_terms_text_hash: TERMS_TEXT_HASH,
  });
  if (error) {
    console.error("signup preparation failed", error.code);
    return await apiError("apiErr.signupFailed", 503);
  }

  // Mail delivery and provider failures stay out of the public response.
  after(() => sendSignupMail(req, email, locale, existing ? null : token));
  return NextResponse.json({ ok: true, pendingVerification: true });
}
