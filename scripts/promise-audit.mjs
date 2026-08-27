// ============================================================================
// TableTap — does the screen promise something the system cannot deliver?
//
// The class of bug the user found three times running, and always before we
// did:
//
//   · the activity log rendered in full for a manager the database gave zero rows
//   · the cart said "pay now by card" with no card button on screen
//   · a switch that was on did not do what its label said
//
// All the same shape: the interface asserts one thing and the data layer
// another. Nothing caught it because each half, on its own, is fine.
//
// This opens every screen as every role and looks for modules that show their
// controls — a search box, sort buttons — with nothing behind them and no word
// about being empty. An empty module that says so is an answer; one that stays
// silent is a broken screen.
//
//   pnpm promises
//   pnpm promises --prod
// ============================================================================
import { join } from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { CREW } from "./layout-paths.mjs";
import { requireServer } from "./preflight.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));
const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";
const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

await requireServer(BASE);

let failed = 0;
const ok = m => console.log(`    ok       ${m}`);
const bad = m => { failed++; console.log(`    GAP      ${m}`); };

/**
 * What is measured inside each section.
 *
 * Controls are things you interact with: if they are there, the section invites
 * you to do something. Rows are any data. A declared empty state is the text
 * that says "nothing here yet" — the app already uses it in several places, and
 * it is what separates an honest answer from silence.
 */
const AUDIT = `(() => {
  const ROWS = ".tt-log-row,.tt-prod,.tt-order-card,.tt-bill-row,.tt-table-row," +
    ".tt-coupon-row,.tt-hist-row,.tt-rate-row,.tt-menu-row,.tt-doc-row,.tt-card," +
    "tbody tr,li";
  const out = [];

  // Only controls that presuppose data count: search, sort, paginate, filter. A
  // form for CREATING something — two password boxes, a new dish — promises
  // nothing that is not there, and flagging it would be noise.
  const isOverData = section => {
    if (section.querySelector("button[class*='sort'],[class*='pager'],[class*='paginat']")) return true;
    for (const input of section.querySelectorAll("input")) {
      const hint = ((input.placeholder || "") + " " + (input.getAttribute("aria-label") || "")).toLowerCase();
      if (input.type === "search" || /busca|buscar|search|filtr/.test(hint)) return true;
    }
    return false;
  };

  for (const section of document.querySelectorAll(".tt-section")) {
    const heading = section.querySelector("h2,h3,h4");
    if (!heading) continue;
    const title = heading.textContent.trim().slice(0, 40);

    // A skeleton is still loading, not empty.
    if (section.querySelector("[class*='keleton']")) continue;
    if (!isOverData(section)) continue;

    const rows = section.querySelectorAll(ROWS);
    if (rows.length > 0) continue;

    // What is left once heading and controls are removed: if it says anything, the
    // section is explaining itself — "nothing yet" — which is an honest answer.
    const clone = section.cloneNode(true);
    for (const el of clone.querySelectorAll("h2,h3,h4,input,select,textarea,button,label,style,script")) el.remove();
    const prose = clone.textContent.replace(/\s+/g, " ").trim();
    if (prose.length >= 25) continue;

    out.push({ title, prose: prose.slice(0, 30) });
  }
  return out;
})()`;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const cookieFor = async email => {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const { data } = await auth.auth.signInWithPassword({ email, password: "demo123" });
  return { name: `sb-${ref}-auth-token`, value: `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`, url: BASE };
};

const { data: restaurant } = await admin
  .from("restaurants").select("id").eq("name", "Demo Bistro").maybeSingle();
const { data: table } = await admin
  .from("restaurant_tables").select("id").eq("restaurant_id", restaurant.id).limit(1).maybeSingle();

const browser = await chromium.launch();
console.log(`\nPromises — ${prod ? "production" : "development"}\n`);

for (const who of CREW) {
  console.log(`  ${who.role}\n`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([await cookieFor(who.email), { name: "tt-locale", value: "es", url: BASE }]);
  for (const path of who.pages) {
    const tab = await ctx.newPage();
    try {
      await tab.goto(BASE + path, { waitUntil: "networkidle" });
      // Modules that read from the browser take a moment longer than the page.
      await tab.waitForTimeout(1800);
      const holes = await tab.evaluate(AUDIT);
      if (holes.length === 0) ok(`${path}`);
      else for (const h of holes) {
        bad(`${path} · «${h.title}» offers search or sort with nothing to search, and does not say so`);
      }
    } catch (e) {
      bad(`${path} · could not be checked (${e.message.slice(0, 60)})`);
    }
    await tab.close();
  }
  await ctx.close();
  console.log("");
}

// The diner, who loses most when a screen promises more than it has.
const guest = await browser.newContext({ viewport: { width: 390, height: 844 } });
await guest.addCookies([{ name: "tt-locale", value: "es", url: BASE }]);
console.log("  comensal\n");
for (const [name, path] of [
  ["QR general", `/r/${restaurant.id}`],
  ["QR de mesa", `/r/${restaurant.id}/t/${table.id}`],
]) {
  const tab = await guest.newPage();
  await tab.goto(BASE + path, { waitUntil: "networkidle" });
  await tab.waitForTimeout(1800);
  const holes = await tab.evaluate(AUDIT);
  if (holes.length === 0) ok(name);
  else for (const h of holes) bad(`${name} · «${h.title}» offers search or sort with nothing to search`);
  await tab.close();
}
await guest.close();

// ── States, which is where the promises break ──────────────────────────────
//
// Every gap found by hand lived in a state, not on a page: orders paused, no
// menu serving, no Stripe connected. A screen that is fine with the demo's
// full data can still be a blank page or a dead button once a switch moves,
// and nothing swept those.
//
// Each case flips one switch, looks, and puts it back. The rule is the same as
// above: a screen with nothing to offer has to SAY so.
const { data: full } = await admin.from("restaurants").select("*").eq("id", restaurant.id).single();
const { data: menuRows } = await admin.from("menus").select("id, active").eq("restaurant_id", restaurant.id);

const STATES = [
  {
    name: "orders paused",
    apply: () => admin.from("restaurants").update({ accepting_orders: false }).eq("id", restaurant.id),
    says: /no estamos tomando pedidos|not taking orders/i,
  },
  {
    name: "no menu serving",
    apply: () => admin.from("menus").update({ active: false }).eq("restaurant_id", restaurant.id),
    says: /cerrados|closed/i,
  },
];

console.log("\n  states\n");

// The dashboard's own frozen state: the API answers 402 to every write while
// the panel used to go on rendering enabled controls, with nothing on screen
// saying why the save failed.
{
  await admin.from("restaurants").update({ plan_status: "locked" }).eq("id", restaurant.id);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([await cookieFor(CREW[0].email), { name: "tt-locale", value: "es", url: BASE }]);
  const tab = await ctx.newPage();
  try {
    await tab.goto(`${BASE}/dashboard/settings`, { waitUntil: "networkidle" });
    await tab.waitForTimeout(1600);
    const text = await tab.evaluate("document.body.innerText");
    if (/solo de lectura|read-only/i.test(text)) ok("subscription paused — the dashboard says it is read-only");
    else bad("subscription paused — the dashboard offers controls and never says saves will fail");
  } catch (e) {
    bad(`subscription paused — could not be checked (${e.message.slice(0, 50)})`);
  }
  await tab.close();
  await ctx.close();
  await admin.from("restaurants").update({ plan_status: full.plan_status }).eq("id", restaurant.id);
}

const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await guestCtx.addCookies([{ name: "tt-locale", value: "es", url: BASE }]);
for (const state of STATES) {
  await state.apply();
  const tab = await guestCtx.newPage();
  try {
    await tab.goto(`${BASE}/r/${restaurant.id}/t/${table.id}`, { waitUntil: "networkidle" });
    await tab.waitForTimeout(1800);
    const text = await tab.evaluate("document.body.innerText");
    if (state.says.test(text)) ok(`${state.name} — the screen says so`);
    else bad(`${state.name} — the screen shows nothing and explains nothing`);
  } catch (e) {
    bad(`${state.name} — could not be checked (${e.message.slice(0, 50)})`);
  }
  await tab.close();
  // Always put it back, whatever the result: a check that leaves the demo
  // switched off is a check that looks like a bug tomorrow.
  await admin.from("restaurants").update({ accepting_orders: full.accepting_orders }).eq("id", restaurant.id);
  for (const m of menuRows ?? []) await admin.from("menus").update({ active: m.active }).eq("id", m.id);
}
await guestCtx.close();


await browser.close();
console.log(failed === 0 ? "\nNo screen promises more than it has.\n" : `\n${failed} GAP(S) — review one by one.\n`);
process.exit(failed === 0 ? 0 : 1);
