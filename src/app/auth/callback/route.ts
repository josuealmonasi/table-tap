import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /auth/callback — where Supabase auth email links land (e.g. password
// reset). It turns the one-time token into a real session cookie, then sends
// the user on to `next` (the reset form). Handles both the PKCE `code` flow and
// the `token_hash` flow so it works with the hosted email and admin links alike.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Only ever redirect to our own paths — never an attacker-supplied URL.
  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  const supabase = await createClient();
  let failed = false;
  if (code) {
    failed = Boolean((await supabase.auth.exchangeCodeForSession(code)).error);
  } else if (tokenHash && type) {
    failed = Boolean((await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error);
  } else {
    failed = true;
  }

  if (failed) {
    return NextResponse.redirect(`${origin}/forgot-password?error=expired`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
