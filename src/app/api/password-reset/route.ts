import { after, NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { jsonBody } from "@/lib/json-body";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { isInboxMailCapped } from "@/lib/signup-mail-ceiling";
import { siteOrigin } from "@/lib/site-origin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** The one answer every well-formed request gets, account or not. */
const SAME_ANSWER = { ok: true } as const;

/**
 * POST /api/password-reset { email } — sends the reset email.
 *
 * The form used to ask Supabase from the browser, and Supabase rate-limits
 * and mails only addresses that have an account, so its 429 told a script
 * which addresses do. Here the answer is the same 200 whatever happens after
 * the address is read: no account, the inbox's ceiling reached, Auth refusing
 * or the mail failing. The send runs after the response, through the same
 * Auth email template (its link carries the token in the fragment).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`password-reset:${clientKey(req)}`, 5, 60)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }
  const body = await jsonBody<{ email?: unknown }>(req);
  if (typeof body?.email !== "string" || !isValidEmail(body.email)) return await apiError("apiErr.email", 400);
  const email = normalizeEmail(body.email);
  if (await isInboxMailCapped("password-reset", email)) return NextResponse.json(SAME_ANSWER);

  const redirectTo = `${siteOrigin(req)}/auth/callback?next=/reset-password`;
  after(async () => {
    try {
      const { error } = await createAdminClient().auth.resetPasswordForEmail(email, { redirectTo });
      if (error) console.error("password reset send failed", error.code ?? error.status);
    } catch {
      console.error("password reset send failed");
    }
  });
  return NextResponse.json(SAME_ANSWER);
}
