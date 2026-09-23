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
import { changedParts, fingerprint, holdWrites } from "./hold-writes.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));

const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";
// The narrow end of the phone band, not the iPhone: no breakpoint falls
// between 360 and 390, so 360 is the same rules with 30px less room, and the
// harder of the two. `pnpm layout` still measures 390.
const WIDTHS = [360, 1280];

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const auth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

// What the sweep is about to click through, fingerprinted with the secret key
// so it can be compared once the sweep is over. See hold-writes.mjs.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DEMO = "Demo Bistro";
const before = await fingerprint(admin, DEMO);
const held = [];

let failed = 0;
let opened = 0;
const ok = w => console.log(`    ok       ${w}`);
const bad = (w, faults) => {
  failed++;
  console.log(`    BAD      ${w}`);
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
    await holdWrites(ctx, held);
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
          const where = `${who.role} · ${path} → «${label}»`;
          // An audit that throws used to become an empty list, and an empty
          // list prints ok — so the one dialog heavy enough to break the check
          // was the one reported as flawless. A check that cannot run is not a
          // check that passed.
          let faults;
          try {
            faults = await tab.evaluate(AUDIT);
          } catch (e) {
            failed++;
            console.log(`    BAD      ${where}: the audit could not run — ${e.message.split("\n")[0]}`);
            await tab.keyboard.press("Escape");
            await tab.waitForTimeout(350);
            return "done";
          }
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

// Held back is fine — that is a button doing its job with nobody listening. A
// change that got through anyway is not: it is the seed another gate reads.
console.log(`\n  ${held.length} write(s) held back in the browser.`);
const moved = changedParts(before, await fingerprint(admin, DEMO));
if (moved.length) {
  failed++;
  console.log(`  BAD      the sweep changed ${DEMO}'s data anyway: ${moved.join(", ")}`);
}

console.log(
  failed === 0
    ? `\nAll ${opened} dialogs read.\n`
    : `\n${failed} of ${opened} DIALOGS DO NOT READ.\n`,
);
process.exit(failed === 0 ? 0 : 1);
