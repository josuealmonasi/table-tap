import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { forgetBrowserMember } from "./table-member-fixture.mjs";

// A failed sign-in stops the visit rather than measuring the login screen once
// for every page the role was meant to see — which reads as ok, every time.
export async function crewCookies(crew, base, phase) {
  const cookies = new Map();
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  for (const who of crew) {
    const password = who.passwordEnv ? process.env[who.passwordEnv] : "demo123";
    if (!password) {
      cookies.set(who.role, { skip: `${who.passwordEnv} is not set — skipped` });
      continue;
    }
    try {
      const cookie = await phase("auth", async () => {
        const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } });
        const { data, error } = await auth.auth.signInWithPassword({ email: who.email, password });
        if (error || !data?.session) throw new Error(`could not sign in as ${who.email}: ${error?.message ?? "no session"}`);
        return { name: `sb-${ref}-auth-token`,
          value: `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`, url: base };
      });
      cookies.set(who.role, { cookie });
    } catch (error) { cookies.set(who.role, { error }); }
  }
  return cookies;
}

export async function isolateMember(ctx, admin, base, diner, prod) {
  if (diner) {
    // Each flow is its own phone. Preseeding also lets cleanup find admission
    // created during a timeout, before the page has finished loading.
    await ctx.addCookies([{ name: "tt-table-member", value: randomBytes(32).toString("base64url"), url: base }]);
  }
  const close = ctx.close.bind(ctx);
  let closing;
  ctx.close = () => closing ??= (async () => {
    // Stop clicks and pending requests before deleting the visit's membership.
    // Cookies remain available until the context itself closes.
    try {
      await Promise.all(ctx.pages().map(page => page.close()));
      if (!prod) await forgetBrowserMember(ctx, admin);
    } finally { await close(); }
  })();
}
