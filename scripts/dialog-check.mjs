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
import { watchDevWorker } from "./preflight.mjs";
import { DEV_URL } from "./dev-url.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));

const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : DEV_URL;
watchDevWorker(BASE);
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
  // The layout audit reports a measured thing; the typing check, a sentence.
  for (const f of faults) console.log(`             ${typeof f === "string" ? f : `${f.kind}: «${f.text}» (${f.w}px)`}`);
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

/**
 * Typing into a dialog's fields: does each keep its focus and its text?
 *
 * Every form in a dialog lost focus after one character — it jumped back to
 * the first field — because the dialog re-ran its "move focus in" effect on
 * every render. Measuring the dialog never noticed: it looked perfect, it just
 * could not be typed into. So this types, the way a person does, and checks
 * the cursor stayed and the characters arrived.
 */
const TYPABLE =
  "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range])" +
  ":not([type=color]):not([type=date]):not([type=time]):not([type=datetime-local]):not([type=month])" +
  ":not([type=week]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])";
async function typingFaults(tab, scope = "[role=dialog]", most = 4) {
  const faults = [];
  const fields = tab.locator(scope).last().locator(TYPABLE);
  const n = Math.min(await fields.count(), most);
  for (let i = 0; i < n; i++) {
    const field = fields.nth(i);
    if (!(await field.isVisible().catch(() => false))) continue;
    const name = await field.evaluate(e => e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.name || e.type);
    const chars = (await field.getAttribute("type")) === "number" ? "12" : "ab";
    try {
      await field.click({ timeout: 3000 });
      await tab.keyboard.type(chars, { delay: 40 });
      const stayed = await field.evaluate(e => document.activeElement === e);
      const value = await field.inputValue();
      if (!stayed) {
        const now = await tab.evaluate(() => {
          const a = document.activeElement;
          return a ? a.getAttribute("aria-label") || a.getAttribute("placeholder") || a.tagName.toLowerCase() : "nothing";
        });
        faults.push(`typing in «${name}» moved the cursor to «${now}»`);
      } else if (!value.toLowerCase().includes(chars)) {
        // Case aside: a coupon code and the promotion search write in capitals.
        faults.push(`typing «${chars}» in «${name}» left «${value}»`);
      }
    } catch {
      // A field that cannot be clicked is the layout audit's business, not this one's.
    }
  }
  return faults;
}

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

      // The page's own fields first, before any dialog opens: a field rebuilt
      // on every keystroke loses its cursor the same way outside a dialog.
      const pageFaults = await typingFaults(tab, "main, body", 8).catch(() => []);
      const pageWhere = `${who.role} · ${path} (its own fields)`;
      pageFaults.length ? bad(pageWhere, pageFaults) : ok(pageWhere);
      await tab.goto(BASE + path, { waitUntil: "load", timeout: 60000 }).catch(() => {});
      await tab.waitForTimeout(1200);

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
          faults = [...faults, ...(await typingFaults(tab))];
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
