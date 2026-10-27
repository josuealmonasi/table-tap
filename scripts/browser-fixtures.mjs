import { deadline } from "./browser-deadline.mjs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { forgetBrowserMember } from "./table-member-fixture.mjs";
import { sessionCookie } from "./session-cookie.mjs";

/** A role this run leaves out on purpose: `GATE_SKIP_ROLES=admin,…`. */
export function skippedOnPurpose(role) {
  return (process.env.GATE_SKIP_ROLES ?? "").split(",").map(r => r.trim()).includes(role);
}

// A failed sign-in stops the visit rather than measuring the login screen once
// for every page the role was meant to see — which reads as ok, every time.
export async function crewCookies(crew, base, phase) {
  const cookies = new Map();
  for (const who of crew) {
    const password = who.passwordEnv ? process.env[who.passwordEnv] : "demo123";
    if (!password) {
      // A login that cannot be made is a screen nobody checked. It used to be
      // "skipped", and a skipped visit counts as passed, so every admin screen
      // could go unchecked under a green gate (audit L, finding 9). Only a run
      // that names the role on purpose leaves it out.
      cookies.set(who.role, skippedOnPurpose(who.role)
        ? { skip: `${who.passwordEnv} is not set — skipped (GATE_SKIP_ROLES)` }
        : { error: new Error(`${who.passwordEnv} is not set, so no ${who.role} screen can be checked. Set it, or GATE_SKIP_ROLES=${who.role} to leave them out on purpose`) });
      continue;
    }
    try {
      const cookie = await phase("auth", async () => {
        const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
          { auth: { persistSession: false, autoRefreshToken: false } });
        const { data, error } = await auth.auth.signInWithPassword({ email: who.email, password });
        if (error || !data?.session) throw new Error(`could not sign in as ${who.email}: ${error?.message ?? "no session"}`);
        return { ...sessionCookie(data.session, process.env.NEXT_PUBLIC_SUPABASE_URL), url: base };
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
      await deadline(5000, () => Promise.all(ctx.pages().map(page => page.close())), undefined, 5000, "diner pages close");
      if (!prod) await deadline(5000, () => forgetBrowserMember(ctx, admin), undefined, 5000, "diner membership cleanup");
    } finally { await deadline(5000, close, undefined, 5000, "diner context close"); }
  })();
}
