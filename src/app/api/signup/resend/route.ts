import { after, NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { newSignupToken, signupHash, type PendingSignup } from "@/lib/pending-signup";
import { resendLegacySignupConfirmation, sendSignupMail } from "@/lib/signup-confirmation";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Resending never changes a password, a restaurant or an existing trial. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`signup-resend:${clientKey(req)}`, 5, 60)) return await apiError("apiErr.tooManyAttempts", 429);
  const body = await jsonBody<{ email?: unknown }>(req);
  if (typeof body?.email !== "string" || !isValidEmail(body.email)) return await apiError("apiErr.signupFields", 400);
  const email = normalizeEmail(body.email);
  const admin = createAdminClient();
  const { data: pending, error } = await admin.from("pending_signups").select("payload, expires_at")
    .eq("email_hash", signupHash(email)).gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false }).limit(1).maybeSingle<Pick<PendingSignup, "payload" | "expires_at">>();
  if (error) return await apiError("auth.verificationSendFailed", 503);
  if (pending) {
    // A resend keeps the original deadline and leaves earlier copies usable.
    const token = newSignupToken();
    const { error: insertError } = await admin.from("pending_signups").insert({
      email_hash: signupHash(email), token_hash: signupHash(token),
      payload: pending.payload, expires_at: pending.expires_at,
    });
    if (insertError) return await apiError("auth.verificationSendFailed", 503);
    after(() => sendSignupMail(req, email, pending.payload.locale, token));
  } else {
    after(() => resendLegacySignupConfirmation(req, email));
  }
  return NextResponse.json({ ok: true });
}
