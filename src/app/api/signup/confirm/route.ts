import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { signupHash, type PendingSignup } from "@/lib/pending-signup";
import { passwordTooShort } from "@/lib/password";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`signup-confirm:${clientKey(req)}`, 5, 60)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }
  const body = await jsonBody<{ token?: unknown; password?: unknown }>(req);
  if (typeof body?.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) {
    return await apiError("auth.signupLinkInvalid", 410);
  }
  if (typeof body.password !== "string" || passwordTooShort(body.password)) {
    return await apiError("apiErr.password8", 400);
  }

  const admin = createAdminClient();
  const { data: pending, error } = await admin.from("pending_signups").select("id, payload")
    .eq("token_hash", signupHash(body.token)).gt("expires_at", new Date().toISOString())
    .maybeSingle<Pick<PendingSignup, "id" | "payload">>();
  if (error) return await apiError("apiErr.signupFailed", 503);
  if (!pending) return await apiError("auth.signupLinkInvalid", 410);

  const locale = pending.payload.locale;
  // Auth confirms the email inside its transaction. The database trigger
  // consumes this signup and provisions the restaurant in that transaction.
  // A stale unconfirmed login under this address (one made by calling Auth's
  // public signup directly after the request was stored) would make Auth
  // refuse the mailbox owner. Release it first; a login something vouches for
  // (a staff invite, a restaurant) stays, and Auth then refuses as before.
  const { error: releaseError } = await admin.rpc("release_stale_signup_login_v1", { p_email: pending.payload.email });
  if (releaseError) {
    console.error("signup confirmation release failed", releaseError.code);
    return await apiError("apiErr.signupFailed", 503);
  }
  const { data, error: authError } = await admin.auth.admin.createUser({
    email: pending.payload.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { locale },
    app_metadata: { pending_signup_id: pending.id },
  });
  if (authError?.code === "email_exists" || authError?.code === "user_already_exists") {
    return await apiError("auth.signupLinkInvalid", 410);
  }
  if (authError?.code === "weak_password") return await apiError("auth.weakPassword", 400);
  if (authError || !data?.user) {
    console.error("signup confirmation failed", authError?.code);
    return await apiError("apiErr.signupFailed", 503);
  }
  return NextResponse.json({ ok: true });
}
