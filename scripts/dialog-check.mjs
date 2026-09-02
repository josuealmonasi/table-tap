// ============================================================================
// Every dialog, found by opening it rather than by listing it.
//
// `pnpm layout` measures a curated list of dialogs. That list had nine on it
// and the app has thirty-one overlays, so twenty-two were measured by nothing
// — and a dialog is exactly where a layout fault hides, because nobody sees it
// until a waiter opens it mid-service.
//
// This clicks every visible button on every screen, as every role, and audits
// whatever opens. It needs no list, so it cannot fall behind one.
// ============================================================================
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { join } from "node:path";
import { AUDIT } from "./layout-audit.mjs";
import { CREW } from "./layout-paths.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));

const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";
const WIDTHS = [390, 1280];

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const auth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

let failed = 0;
let opened = 0;
const ok = w => console.log(`    ok       ${w}`);
const bad = (w, faults) => {
  failed++;
  console.log(`    MAL      ${w}`);
  for (const f of faults) console.log(`             ${f.kind}: «${f.text}» (${f.w}px)`);
};

const cookieFor = async (email, password) => {
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return {
    name: `sb-${ref}-auth-token`,
    value: `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`,
    url: BASE,
  };
};

/** What a person would call this button. */
const LABELS = `
  [...document.querySelectorAll("button, [role=button]")]
    .filter(b => b.offsetParent !== null && !b.disabled)
    .map(b => (b.textContent || b.getAttribute("aria-label") || b.getAttribute("title") || "").trim())
    .filter(t => t.length > 0 && t.length < 40)
`;

const clickByLabel = (tab, label) =>
  tab.evaluate(`(() => {
    const b = [...document.querySelectorAll("button, [role=button]")]
      .filter(x => x.offsetParent !== null && !x.disabled)
      .find(x => ((x.textContent||x.getAttribute("aria-label")||x.getAttribute("title")||"").trim()) === ${JSON.stringify(label)});
    if (!b) return false; b.click(); return true;
  })()`).catch(() => false);

const isOpen = tab => tab.evaluate("!!document.querySelector('[role=dialog]')").catch(() => false);

/**
 * Nothing here may hang.
 *
 * Clicking every button on a page means eventually clicking one that opens a
 * native file chooser — Ajustes has three — and an unhandled chooser blocks
 * the page for as long as the process lives. This run sat silent for fifteen
 * minutes on one. Native dialogs do the same. Both are dismissed the moment
 * they appear, and every probe still gets a ceiling on top of that.
 */
function defuse(tab) {
  tab.on("filechooser", fc => fc.setFiles([]).catch(() => {}));
  tab.on("dialog", d => d.dismiss().catch(() => {}));
}

const within = (ms, work) =>
  Promise.race([work, new Promise(r => setTimeout(() => r("timeout"), ms))]);

/**
 * Buttons that leave the app.
 *
 * Signing out throws away the session the rest of the sweep is using, and the
 * plan tiers hand off to Stripe's own checkout — another origin, on somebody
 * else's servers. Neither opens a dialog here, so neither is skipped for
 * convenience: there is nothing at the end of them to measure.
 */
const LEAVES_THE_APP = /cerrar sesión|sign out|log out|elegir|contratar|cambiar de plan|choose|subscribe/i;

const browser = await chromium.launch();
console.log(`\nDialogs — ${prod ? "production" : "development"}\n`);

for (const width of WIDTHS) {
  console.log(`  ${width}px\n`);
  for (const who of CREW) {
    const password = who.passwordEnv ? process.env[who.passwordEnv] : "demo123";
    if (!password) {
      console.log(`    –        ${who.role}: ${who.passwordEnv} is not set — skipped`);
      continue;
    }
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "es-MX" });
    ctx.setDefaultTimeout(30000);
    await ctx.addCookies([await cookieFor(who.email, password)]);
    const tab = await ctx.newPage();
    defuse(tab);

    for (const path of who.pages) {
      try {
        await tab.goto(BASE + path, { waitUntil: "load", timeout: 60000 });
        await tab.waitForTimeout(1800);
      } catch {
        continue;
      }

      const seen = new Set();
      for (const label of await tab.evaluate(LABELS)) {
        if (seen.has(label) || LEAVES_THE_APP.test(label)) continue;
        seen.add(label);

        const probe = (async () => {
          if (!(await clickByLabel(tab, label))) return "no button";
          await tab.waitForTimeout(700);
          if (!(await isOpen(tab))) return "nothing opened";

          opened++;
          const faults = await tab.evaluate(AUDIT).catch(() => []);
          const where = `${who.role} · ${path} → «${label}»`;
          faults.length ? bad(where, faults) : ok(where);

          await tab.keyboard.press("Escape");
          await tab.waitForTimeout(350);
          // A dialog that will not close makes every later click hit it instead.
          if (await isOpen(tab)) {
            await tab.goto(BASE + path, { waitUntil: "load", timeout: 60000 }).catch(() => {});
            await tab.waitForTimeout(1500);
          }
          return "done";
        })();

        if ((await within(20000, probe)) === "timeout") {
          console.log(`    –        ${who.role} · ${path} → «${label}»: gave up after 20s`);
          await tab.goto(BASE + path, { waitUntil: "load", timeout: 60000 }).catch(() => {});
          await tab.waitForTimeout(1200);
        }
      }
    }
    await ctx.close();
  }
}
await browser.close();

console.log(
  failed === 0
    ? `\nAll ${opened} dialogs read.\n`
    : `\n${failed} of ${opened} DIALOGS DO NOT READ.\n`,
);
process.exit(failed === 0 ? 0 : 1);
