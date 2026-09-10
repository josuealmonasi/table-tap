import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/csp";

type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

/**
 * Keeps the Supabase session fresh on every request, and carries the policy.
 *
 * The Content-Security-Policy lives here rather than in `next.config.ts`
 * because it holds a nonce, and a nonce has to be new on every request or it
 * is just a password an attacker can read off the page. Setting it on the
 * REQUEST is what lets Next stamp the same value on its own bootstrap script;
 * setting it on the response is what makes the browser enforce it.
 */
export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production");

  // Built fresh each time rather than snapshotted: Supabase refreshes the
  // session by writing cookies onto the REQUEST, and a response made from a
  // stale copy of its headers would send the old ones back.
  const carry = () => {
    const headers = new Headers(request.headers);
    headers.set("content-security-policy", csp);
    return NextResponse.next({ request: { headers } });
  };

  let response = carry();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = carry();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
