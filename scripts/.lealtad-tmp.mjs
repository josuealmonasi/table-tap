import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.development.local");
const env = process.env, BASE = "http://localhost:3000";
const OUT = "/private/tmp/claude-501/-Users-josuealmonasi-src/a9dfbc64-7100-48da-bb70-243a0e789195/scratchpad";
const STATE = process.env.STATE ?? "on";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const auth = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const { data } = await auth.auth.signInWithPassword({ email: "demo@tabletap.dev", password: "demo123" });
const session = { name: `sb-${ref}-auth-token`, value: `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`, url: BASE };
const browser = await chromium.launch();
for (const [w, h] of [[360, 900], [390, 900], [820, 1100], [1280, 1000]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addCookies([session, { name: "tt-locale", value: "es", url: BASE }]);
  const tab = await ctx.newPage();
  await tab.goto(`${BASE}/dashboard/loyalty`, { waitUntil: "networkidle" });
  await tab.waitForTimeout(2500);
  const m = await tab.evaluate(() => {
    const H = el => el ? Math.round(el.getBoundingClientRect().height) : null;
    const secs = [...document.querySelectorAll(".tt-section")];
    const ps = sel => [...document.querySelectorAll(sel)].map(H);
    return {
      status: H(document.querySelector(".tt-loyalty-status")),
      sections: secs.map(s => `${s.querySelector("h2")?.textContent?.slice(0, 12)}:${H(s)}`),
      programHint: H(secs[0]?.querySelector("p.tt-muted")),
      notes: [...(secs[0]?.querySelectorAll("p.tt-muted") ?? [])].map(H),
      lookupHint: H([...secs].find(s => /Buscar/.test(s.textContent))?.querySelector("p.tt-muted:last-of-type")),
      pageW: document.documentElement.scrollWidth,
    };
  });
  console.log(STATE, w, JSON.stringify(m));
  await tab.screenshot({ path: `${OUT}/lealtad-${STATE}-${w}.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
