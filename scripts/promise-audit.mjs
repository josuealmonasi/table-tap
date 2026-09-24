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
//   pnpm promises --prod   (the sweeps only: every state writes, see below)
// ============================================================================
import { join } from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { CREW } from "./layout-paths.mjs";
import { AUDIT, REFUSAL, STATES } from "./promise-cases.mjs";
import { requireServer, warm } from "./preflight.mjs";

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
// A sign-in that fails must stop the sweep. It used to go on with a cookie
// holding the word "null": every page redirected to the login screen, the
// login screen offers nothing to search, and nine of a manager's screens
// printed ok without one of them being seen. It took a network blip to show.
const cookieFor = async (email, password = "demo123") => {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data?.session) throw new Error(`could not sign in as ${email}: ${error?.message ?? "no session"}`);
  return { name: `sb-${ref}-auth-token`, value: `base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`, url: BASE };
};

const { data: restaurant } = await admin
  .from("restaurants").select("id").eq("name", "Demo Bistro").maybeSingle();
const { data: table } = await admin
  .from("restaurant_tables").select("id").eq("restaurant_id", restaurant.id).limit(1).maybeSingle();

// Compile every route this sweep opens, before it opens any of them. In
// development Next builds a route the first time anything asks for it, and a
// cold one can take longer than Playwright will wait — the sweep then reports a
// perfectly good screen as unreachable. Three gate runs and one wrong diagnosis
// went that way before this existed.
if (!prod) {
  await warm(BASE, [
    ...CREW.flatMap(r => r.pages ?? []),
    ...STATES.flatMap(c => (c.path ? [c.path] : [])),
    `/r/${restaurant.id}`,
    `/r/${restaurant.id}/t/${table.id}`,
  ]);
}

const browser = await chromium.launch();
console.log(`\nPromises — ${prod ? "production" : "development"}\n`);

for (const who of CREW) {
  console.log(`  ${who.role}\n`);
  // The platform admin's password is not the demo one. This used to sign in
  // with demo123 regardless, fail, and check the admin screen signed out on
  // every run there has been — reported ok each time.
  const password = who.passwordEnv ? process.env[who.passwordEnv] : undefined;
  if (who.passwordEnv && !password) {
    console.log(`    –        ${who.passwordEnv} is not set — skipped\n`);
    continue;
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([await cookieFor(who.email, password), { name: "tt-locale", value: "es", url: BASE }]);
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
console.log("  diner\n");
for (const [name, path] of [
  ["general QR", `/r/${restaurant.id}`],
  ["table QR", `/r/${restaurant.id}/t/${table.id}`],
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

async function finish() {
  await browser.close();
  console.log(failed === 0 ? "\nNo screen promises more than it has.\n" : `\n${failed} GAP(S) — review one by one.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── States ─────────────────────────────────────────────────────────────────
//
// Each case changes one thing, looks, and hands back whatever it touched. A
// check that leaves the demo switched off is a check that looks like a bug
// tomorrow, so the restore runs whether the case passed, failed or threw.
//
// Never against production. Every state rewrites the restaurant it looks at —
// its plan, its Stripe account, whether it takes orders — and some plant a
// paid order or a table's bill. There that restaurant is live: a run killed
// halfway would leave it locked, or sending diners to a Stripe account that
// does not exist, with a probe sitting in its takings. The sweeps above only
// read, and they did run.
if (prod) {
  console.log("\n  states\n\n    –        not run against production: every one rewrites the live restaurant");
  await finish();
}
const { data: full } = await admin.from("restaurants").select("*").eq("id", restaurant.id).single();
const { data: menuRows } = await admin.from("menus").select("id, active").eq("restaurant_id", restaurant.id);
const { data: loyaltyProgram } = await admin
  .from("loyalty_programs").select("active").eq("restaurant_id", restaurant.id).maybeSingle();
const ctx = { restaurantId: restaurant.id, tableId: table.id };

async function restore() {
  await admin.from("restaurants").update({
    accepting_orders: full.accepting_orders,
    plan: full.plan,
    plan_status: full.plan_status,
    stripe_account_id: full.stripe_account_id,
    stripe_charges_enabled: full.stripe_charges_enabled,
  }).eq("id", restaurant.id);
  for (const m of menuRows ?? []) await admin.from("menus").update({ active: m.active }).eq("id", m.id);
  if (loyaltyProgram) {
    await admin.from("loyalty_programs").update({ active: loyaltyProgram.active }).eq("restaurant_id", restaurant.id);
  }
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

/**
 * A throwaway unpaid order on a table the diners own, so there is a bill to
 * open — and it is THEIR bill.
 *
 * The table is chosen rather than taken: the demo seats a waiter at one, and a
 * bill a waiter opened says so instead of whatever the case came to look at.
 * That is not a finding, it is the wrong table — so the run picks one nobody
 * is sitting at, and says so loudly if there is none rather than measuring the
 * wrong screen.
 */
async function withTableBill(run, frozen = false) {
  const MARK = "promise-audit-bill";
  const { data: dish } = await admin.from("menu_items")
    .select("id, name, emoji, price").eq("restaurant_id", restaurant.id)
    .eq("is_addon", false).eq("available", true).limit(1).single();
  const { data: tables } = await admin.from("restaurant_tables")
    .select("id, label").eq("restaurant_id", restaurant.id).order("label");
  const { data: seated } = await admin.from("table_sessions")
    .select("table_id").eq("restaurant_id", restaurant.id).is("closed_at", null);
  const taken = new Set((seated ?? []).map(s => s.table_id));
  const free = (tables ?? []).find(t => !taken.has(t.id));
  if (!free) {
    bad("no card reader · the bill — every table is seated, so nothing was checked");
    return;
  }
  // With a sitting, because a diner is only ever shown the orders on the
  // table's OPEN one — a loose order on an empty table is invisible to them,
  // and the sweep saw a menu with no bill button on it.
  const { data: sitting } = await admin.from("table_sessions")
    .insert({ restaurant_id: restaurant.id, table_id: free.id })
    .select("id").single();
  await admin.from("orders").insert({
    restaurant_id: restaurant.id, table_id: free.id, table_label: free.label,
    session_id: sitting.id,
    currency: restaurant.currency ?? "MXN",
    items: [{ itemId: dish.id, name: dish.name, emoji: dish.emoji ?? "\u{1F37D}", price: Number(dish.price), qty: 1, mods: {} }],
    subtotal: Number(dish.price), total: Number(dish.price), discount: 0,
    service_fee: 0, tip: 0, tax_pct: 0, status: "received", paid: false, note: MARK,
  });
  // Some cases need the table mid-split, frozen, with this phone holding no
  // share in it — which is what a third diner sees when two of them halved it.
  let split = null;
  if (frozen) {
    const { data: made } = await admin.from("bill_splits").insert({
      restaurant_id: restaurant.id, session_id: sitting.id, shares: 2,
      status: "locked", amount: Number(dish.price), proposed_by: "promise-a",
      locked_at: new Date().toISOString(),
    }).select("id").single();
    split = made.id;
    await admin.from("bill_split_claims").insert([
      { split_id: split, share_no: 0, diner: "promise-a", amount: Number(dish.price) / 2 },
      { split_id: split, share_no: 1, diner: "promise-b", amount: Number(dish.price) / 2 },
    ]);
  }

  try {
    return await run(free);
  } finally {
    if (split) {
      await admin.from("bill_split_claims").delete().eq("split_id", split);
      await admin.from("bill_splits").delete().eq("id", split);
    }
    await admin.from("orders").delete().eq("note", MARK);
    await admin.from("table_sessions").delete().eq("id", sitting.id);
  }
}

console.log("\n  states\n");
for (const state of STATES) {
  // What the phone already remembers, worked out before `apply` changes the
  // menu it is worked out from — a sold-out case must remember the dish that
  // is about to sell out, not whichever one is left.
  const storage = state.storage ? await state.storage(admin, ctx) : null;
  await state.apply?.(admin, ctx);
  const size = state.as === "owner" ? { width: 1280, height: 900 } : { width: 390, height: 844 };
  const context = await browser.newContext({ viewport: size });
  const cookies = [{ name: "tt-locale", value: "es", url: BASE }];
  if (state.as === "owner") cookies.push(await cookieFor(CREW[0].email));
  await context.addCookies(cookies);
  if (storage) {
    await context.addInitScript(entries => {
      for (const [k, v] of entries) localStorage.setItem(k, v);
    }, Object.entries(storage));
  }

  // A button's text, matched against what is actually on screen.
  const visible = (tab, re) => tab.evaluate(
    `[...document.querySelectorAll("button")].filter(b => b.offsetParent && ${re}.test(b.innerText)).length`);

  const visit = async path => {
    const tab = await context.newPage();
    // A route answered the way a busy server answers it. Counted: a screen that
    // never asked would otherwise pass for one that survived the refusal.
    let refused = 0;
    const refuse = () => tab.route(state.refuse.url, route => {
      refused++;
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: REFUSAL.es }),
      });
    });
    try {
      if (state.refuse && !state.refuse.afterOpen) await refuse();
      await tab.goto(BASE + path, { waitUntil: "networkidle" });
      // Wait for what the case is about, not for a number of milliseconds. A
      // fixed 1.7s was usually enough; on a slow compile the plan lock arrived
      // after it, and "free plan · promotions" failed as "shows nothing and
      // explains nothing" — a red gate over nothing, then green on a rerun,
      // which is how a gate teaches people to ignore it. A screen that truly
      // never says it still fails, ten seconds later.
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const text = await tab.evaluate("document.body.innerText");
        // The most specific signal first. The words a case looks for can be on
        // the page before the page is — "Cuentas" is in the navigation while
        // the bills still load — so a control is the better sign it is there.
        const ready = state.open
          ? (await visible(tab, state.open)) > 0
          : state.keeps
            ? (await visible(tab, state.keeps)) > 0
            : state.says.test(text);
        if (ready) break;
        await tab.waitForTimeout(250);
      }
      // A breath, so a control that renders just after the text is counted.
      await tab.waitForTimeout(600);

      // Some of these live behind a button. Opening it here rather than
      // assuming the page shows everything: the bill is a dialog, and a dialog
      // is exactly where nobody looks until a diner is sitting in front of it.
      if (state.open) {
        if (await visible(tab, state.open) === 0) {
          bad(`${state.name} — nothing on the page opens it, so nothing was checked`);
          await tab.close();
          return;
        }
        await tab.evaluate(
          `[...document.querySelectorAll("button")].find(b => b.offsetParent && ${state.open}.test(b.innerText)).click()`);

        // Wait for what opened, not for a number of milliseconds. A dialog
        // that takes 1.3s on a slow compile made this case report the screen
        // as having hidden its own working button — a red gate over nothing,
        // which is how a gate teaches people to ignore it.
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const ready = state.keeps
            ? (await visible(tab, state.keeps)) > 0
            : (await tab.evaluate(`document.querySelectorAll("dialog[open],[role=dialog]").length`)) > 0;
          if (ready) break;
          await tab.waitForTimeout(250);
        }
        // A breath, so a control that renders just after its neighbour is
        // still counted by `offers`.
        await tab.waitForTimeout(600);
      }

      // Refused only once the screen is up, so it is the NEXT read that fails:
      // what was already on screen is what is being tested.
      if (state.refuse?.afterOpen) {
        await refuse();
        await tab.waitForTimeout(state.refuse.wait);
      }
      if (state.refuse && refused === 0) {
        bad(`${state.name} — nothing asked for ${state.refuse.url}, so nothing was checked`);
        await tab.close();
        return;
      }

      const text = await tab.evaluate("document.body.innerText");
      const offered = state.offers ? await visible(tab, state.offers) > 0 : false;
      // What must survive. Without it, a screen that hid everything — the
      // refused control and the working one together — would pass for honest.
      const kept = state.keeps ? await visible(tab, state.keeps) > 0 : true;
      if (offered) bad(`${state.name} — offers a control the system refuses`);
      else if (!kept) bad(`${state.name} — took away the one thing that still works`);
      else if (state.says.test(text)) ok(`${state.name} — the screen says so`);
      else bad(`${state.name} — the screen shows nothing and explains nothing`);
    } catch (e) {
      bad(`${state.name} — could not be checked (${e.message.slice(0, 45)})`);
    }
    await tab.close();
  };

  try {
    if (state.as === "tracker") await withCounterOrder(id => visit(`/order/${id}`));
    else if (state.as === "bill") {
      await withTableBill(free => visit(`/r/${restaurant.id}/t/${free.id}`), state.frozen);
    } else await visit(state.path ?? `/r/${restaurant.id}/t/${table.id}`);
  } finally {
    await context.close();
    await state.undo?.(admin, ctx);
    await restore();
  }
}

await finish();
