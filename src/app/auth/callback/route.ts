import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { sameSitePost } from "@/lib/same-site-post";

export const runtime = "nodejs";

const TYPES = new Set<EmailOtpType>(["signup", "invite", "recovery", "email_change", "email", "magiclink"]);

// Where Supabase auth email links land (password reset, signup, invite). It
// turns the one-time token into a real session cookie, then sends the user on
// to `next`. Handles both the PKCE `code` flow and the `token_hash` flow.
//
// GET serves the older links that point here directly. The email templates
// (docs/auth-email-templates/) link to /auth/confirm instead, which POSTs here
// from a button: mail scanners (Outlook's Safe Links) open every link in a
// message to check it, and a GET that spends the token spent it before the
// person ever clicked.
async function confirm(origin: string, params: { get(name: string): string | null }): Promise<NextResponse> {
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const rawType = params.get("type") as EmailOtpType | null;
  const type = rawType && TYPES.has(rawType) ? rawType : null;

  // Only ever redirect to our own paths — never an attacker-supplied URL.
  const rawNext = params.get("next") ?? "/dashboard";
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

  // 303: a POST must land on the next page as a GET.
  if (failed) {
    return NextResponse.redirect(`${origin}${next === "/signup/complete" || type === "signup"
      ? "/signup/verify?error=expired" : "/forgot-password?error=expired"}`, 303);
  }
  return NextResponse.redirect(`${origin}${next}`, 303);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  return await confirm(url.origin, url.searchParams);
}

export async function POST(req: NextRequest) {
  const origin = new URL(req.url).origin;
  if (!sameSitePost(req, origin)) return NextResponse.redirect(`${origin}/login`, 303);
  const form = await req.formData().catch(() => null);
  const get = (name: string) => { const v = form?.get(name); return typeof v === "string" ? v : null; };
  return await confirm(origin, { get });
}
