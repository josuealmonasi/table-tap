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
import { AUDIT, STATES } from "./promise-cases.mjs";
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

// ── States ─────────────────────────────────────────────────────────────────
//
// Each case changes one thing, looks, and hands back whatever it touched. A
// check that leaves the demo switched off is a check that looks like a bug
// tomorrow, so the restore runs whether the case passed, failed or threw.
const { data: full } = await admin.from("restaurants").select("*").eq("id", restaurant.id).single();
const { data: menuRows } = await admin.from("menus").select("id, active").eq("restaurant_id", restaurant.id);
const ctx = { restaurantId: restaurant.id, tableId: table.id };

async function restore() {
  await admin.from("restaurants").update({
    accepting_orders: full.accepting_orders,
    plan: full.plan,
    plan_status: full.plan_status,
  }).eq("id", restaurant.id);
  for (const m of menuRows ?? []) await admin.from("menus").update({ active: m.active }).eq("id", m.id);
}

/** A throwaway counter order, for the cases that need one to look at. */
async function withCounterOrder(run) {
  const MARK = "promise-audit";
  const { data: dish } = await admin.from("menu_items")
    .select("id, name, emoji, price").eq("restaurant_id", restaurant.id)
    .eq("is_addon", false).eq("available", true).limit(1).single();
  const { data: order } = await admin.from("orders").insert({
    restaurant_id: restaurant.id, table_id: null, table_label: null,
    currency: restaurant.currency ?? "MXN",
    items: [{ itemId: dish.id, name: dish.name, emoji: dish.emoji ?? "\u{1F37D}", price: Number(dish.price), qty: 1, mods: {} }],
    subtotal: Number(dish.price), total: Number(dish.price), discount: 0,
    service_fee: 0, tip: 0, tax_pct: 0, status: "ready", paid: true, note: MARK,
  }).select("id").single();
  try {
    return await run(order.id);
  } finally {
    await admin.from("orders").delete().eq("note", MARK);
  }
}

console.log("\n  states\n");
for (const state of STATES) {
  await state.apply?.(admin, ctx);
  const size = state.as === "owner" ? { width: 1280, height: 900 } : { width: 390, height: 844 };
  const context = await browser.newContext({ viewport: size });
  const cookies = [{ name: "tt-locale", value: "es", url: BASE }];
  if (state.as === "owner") cookies.push(await cookieFor(CREW[0].email));
  await context.addCookies(cookies);

  const visit = async path => {
    const tab = await context.newPage();
    try {
      await tab.goto(BASE + path, { waitUntil: "networkidle" });
      await tab.waitForTimeout(1700);
      const text = await tab.evaluate("document.body.innerText");
      const offered = state.offers
        ? await tab.evaluate(
            `[...document.querySelectorAll("button")].some(b => b.offsetParent && ${state.offers}.test(b.innerText))`)
        : false;
      if (offered) bad(`${state.name} — offers a control the system refuses`);
      else if (state.says.test(text)) ok(`${state.name} — the screen says so`);
      else bad(`${state.name} — the screen shows nothing and explains nothing`);
    } catch (e) {
      bad(`${state.name} — could not be checked (${e.message.slice(0, 45)})`);
    }
    await tab.close();
  };

  try {
    if (state.as === "tracker") await withCounterOrder(id => visit(`/order/${id}`));
    else await visit(state.path ?? `/r/${restaurant.id}/t/${table.id}`);
  } finally {
    await context.close();
    await restore();
  }
}

await browser.close();
console.log(failed === 0 ? "\nNo screen promises more than it has.\n" : `\n${failed} GAP(S) — review one by one.\n`);
process.exit(failed === 0 ? 0 : 1);
