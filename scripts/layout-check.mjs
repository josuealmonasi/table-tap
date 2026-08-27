// ============================================================================
// TableTap — can the screen actually be read?
//
// Tests say the component exists; they do not say a human can read it. This
// opens every screen in a real browser — as each team role, on phone and
// desktop, opening the dialogs — and fails if text is squashed, overlaps, runs
// off the page, or two cards do not line up.
//
//   pnpm layout          (dev)
//   pnpm layout --prod
// ============================================================================
import { join } from "node:path";
import { chromium } from "playwright";
import { AUDIT } from "./layout-audit.mjs";
import { CREW, DIALOGS, DINER } from "./layout-paths.mjs";
import { requireServer } from "./preflight.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));
const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";

await requireServer(BASE, prod);

const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

const { data: r } = await admin
  .from("restaurants").select("id").eq("name", "Demo Bistro").maybeSingle();
// A free table: one with an open bill opens the order tracker, not the menu,
// and then there is no cart to check.
const { data: tables } = await admin
  .from("restaurant_tables").select("id").eq("restaurant_id", r.id);
const { data: busy } = await admin
  .from("orders").select("table_id").eq("restaurant_id", r.id).eq("paid", false);
const taken = new Set((busy ?? []).map(o => o.table_id));
const table = tables.find(t => !taken.has(t.id)) ?? tables[0];

const SIZES = [
  { name: "teléfono", width: 390, height: 844 },
  { name: "escritorio", width: 1280, height: 900 },
];

let failed = 0;
const ok = m => console.log(`    ok       ${m}`);
const bad = (where, faults) => {
  failed += faults.length;
  console.log(`    MAL      ${where}`);
  for (const f of faults) console.log(`             ${f.kind}: «${f.text}» (${f.w}px)`);
};

/**
 * A navigation that retries once.
 *
 * The dev server drops mid-run and the network failure showed up as though the
 * screen were broken. A false red teaches people to ignore reds.
 */
async function gotoOnce(tab, url, opts) {
  try {
    return await tab.goto(url, opts);
  } catch {
    await tab.waitForTimeout(2000);
    return await tab.goto(url, opts);
  }
}

/** Wait for real content: loading is not the same as having something to measure. */
async function settle(tab) {
  await tab.waitForFunction("document.body.innerText.trim().length > 200", null, {
    timeout: 30000,
  });
  await tab.waitForTimeout(900);
}

/** Click from inside the page: Playwright's click waits for everything to settle. */
const tap = (tab, sel) =>
  tab.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(e){e.click(); return true;} return false;})()`);

const tapText = (tab, text) =>
  tab.evaluate(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>x.textContent.includes(${JSON.stringify(text)})); if(b){b.click(); return true;} return false;})()`);

async function look(tab, where) {
  const faults = await tab.evaluate(AUDIT);
  if (faults.length === 0) ok(where);
  else bad(where, faults);
}

const cookieFor = async email => {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const { data } = await auth.auth.signInWithPassword({ email, password: "demo123" });
  return {
    name: `sb-${ref}-auth-token`,
    value: `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`,
    url: BASE,
  };
};

const browser = await chromium.launch();
console.log(`\nLayout — ${prod ? "production" : "development"}\n`);

for (const size of SIZES) {
  console.log(`  ${size.name} (${size.width}px)\n`);

  // ── The diner ─────────────────────────────────────────────────────────────
  // In both languages: English is longer on some labels and shorter on others,
  // and the cart broke once over a label that did not fit. The dashboard is
  // checked in Spanish only, which is where the team works.
  for (const lang of ["es", "en"]) {
  const diner = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    locale: lang === "es" ? "es-MX" : "en-US",
  });
  // The language belongs to the restaurant, not the phone: the app starts in
  // Spanish no matter what and only the cookie changes it. Setting the browser
  // `locale` and believing it was English measured Spanish twice.
  await diner.addCookies([{ name: "tt-locale", value: lang, url: BASE }]);
  for (const flow of DINER) {
    const tab = await diner.newPage();
    try {
      await gotoOnce(tab, `${BASE}/r/${r.id}/t/${table.id}`, { waitUntil: "load", timeout: 60000 });
      await settle(tab);
      for (const step of flow.steps) {
        if (step.addToCart) {
          await tap(tab, lang === "es"
            ? "button[aria-label^='Agregar ']"
            : "button[aria-label^='Add ']");
          await tab.waitForTimeout(500);
          await tab.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Agregar al carrito|Add to (cart|order)/i.test(x.textContent)); if(b) b.click();})()`);
          await tab.waitForSelector(".tt-fab", { timeout: 8000 });
        }
        // A step that cannot find its button leaves the previous screen up, and then
        // the menu gets measured twice while we think the dish detail was checked.
        // That does not get to pass quietly.
        if (step.click) {
          const sel = typeof step.click === "string" ? step.click : step.click[lang];
          if (!(await tap(tab, sel))) throw new Error(`no encontró «${sel}»`);
        }
        if (step.text) {
          const label = typeof step.text === "string" ? step.text : step.text[lang];
          if (!(await tapText(tab, label))) {
            throw new Error(`no encontró el botón «${label}»`);
          }
        }
        if (step.bottom) {
          await tab.evaluate(`(()=>{const o=document.querySelector('.tt-detail-overlay'); if(o) o.scrollTop=o.scrollHeight;})()`);
        }
        await tab.waitForTimeout(700);
      }
      if (flow.expect?.[lang]) {
        const there = await tab.evaluate(
          `document.body.innerText.includes(${JSON.stringify(flow.expect[lang])})`,
        );
        if (!there) throw new Error(`did not arrive — missing «${flow.expect[lang]}»`);
      }
      await look(tab, `comensal ${lang} · ${flow.name}`);
    } catch (e) {
      failed++;
      console.log(`    MAL      comensal ${lang} · ${flow.name}: ${e.message.split("\n")[0]}`);
    }
    await tab.close();
  }
  await diner.close();
  }

  // ── El equipo ────────────────────────────────────────────────────────────
  for (const who of CREW) {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      locale: "es-MX",
    });
    await ctx.addCookies([await cookieFor(who.email)]);
    for (const path of who.pages) {
      const tab = await ctx.newPage();
      try {
        await gotoOnce(tab, BASE + path, { waitUntil: "load", timeout: 60000 });
        await settle(tab);
        await look(tab, `${who.role} · ${path}`);

        for (const dialog of DIALOGS[path] ?? []) {
          const clicked = dialog.text
            ? await tapText(tab, dialog.text)
            : await tap(tab, dialog.click);
          await tab.waitForTimeout(900);
          // Having clicked does not mean anything opened. A silent no-op reads exactly
          // like an ok, and that is how a whole role went unchecked with nothing
          // saying so.
          const open = await tab.evaluate("!!document.querySelector('[role=dialog]')");
          if (!clicked || !open) {
            console.log(`    –        ${who.role} · ${path} → ${dialog.name}: did not open (no data)`);
            continue;
          }
          await look(tab, `${who.role} · ${path} → ${dialog.name}`);
          await tab.keyboard.press("Escape");
          await tab.waitForTimeout(400);
        }
      } catch (e) {
        failed++;
        console.log(`    MAL      ${who.role} · ${path}: ${e.message.split("\n")[0]}`);
      }
      await tab.close();
    }
    await ctx.close();
  }
  console.log("");
}

await browser.close();
console.log(failed === 0 ? "Everything reads.\n" : `${failed} READABILITY PROBLEM(S).\n`);
process.exit(failed === 0 ? 0 : 1);
