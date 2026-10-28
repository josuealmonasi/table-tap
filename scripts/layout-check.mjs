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
import { createClient } from "@supabase/supabase-js";
import { CREW, DINER, PUBLIC, SPLIT_SCREENS } from "./layout-paths.mjs";
import { requireServer } from "./preflight.mjs";
import { holdWrites } from "./hold-writes.mjs";
import { DEV_URL } from "./dev-url.mjs";
import { pageInScope, reportScope } from "./gate-scope.mjs";
import { browserConcurrency, phaseTimings, runBrowserJobs } from "./browser-jobs.mjs";
import { crewCookies, isolateMember } from "./browser-fixtures.mjs";
import { layoutFixtures } from "./layout-fixtures.mjs";
import { assertAuditControl, look } from "./browser-audit.mjs";
import { navigate, trackData } from "./browser-ready.mjs";
import { dinerVisit, teamVisit } from "./layout-visits.mjs";

import { splitScreenFixture, openSplitScreen } from "./split-slot-screens.mjs";
import { deadline, runWatchdog } from "./browser-deadline.mjs";
import { monitorBrowserServer } from "./browser-server.mjs";

runWatchdog("layout");
const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));
const BASE = prod ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app") : DEV_URL;
const server = prod ? null : monitorBrowserServer(BASE);
process.on("exit", () => { server?.stop(); server?.report(); });
const concurrency = browserConcurrency();
const timings = phaseTimings();
const started = performance.now();
await requireServer(BASE, prod);
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const fixtures = await layoutFixtures(admin);
const cookies = await crewCookies(CREW.filter(w => w.pages.some(pageInScope)), BASE, timings.phase);

// The CSS pivots at 1025px, so everything from 768 to 1024 gets the
// non-desktop layout stretched to its widest — which is every iPad in portrait
// and the base iPad in landscape. Nothing swept that band, and the restaurant
// side is what runs on a tablet at the pass.
//
// 360 is the most common Android width, and the sweep never opened it. At 360
// the menu editor's product row already spilled 28px past its own box (padding
// hid it until 320), and Analytics broke "Cheesecake" in half. Both were
// clean at 390.
const SIZES = [
  { name: "small phone", width: 360, height: 780 },
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1280, height: 900 },
];

const jobs = [];
for (const size of SIZES) {
  const options = { viewport: { width: size.width, height: size.height }, locale: "es-MX" };
  // ── The diner ─────────────────────────────────────────────────────────────
  // In both languages: English is longer on some labels and shorter on others,
  // and the cart broke once over a label that did not fit. The dashboard is
  // checked in Spanish only, which is where the team works.
  for (const lang of ["es", "en"]) for (const flow of DINER) {
    if (!pageInScope(flow.at ?? "/r/_/t/_")) continue;
    jobs.push({ id: `${size.width}px · diner ${lang} · ${flow.name}`, diner: true,
      options: { ...options, locale: lang === "es" ? "es-MX" : "en-US" },
      run: job => dinerVisit(job, { lang, flow, base: BASE, ...fixtures }),
    });
  }
  // ── The front door, signed out ────────────────────────────────────────────
  for (const path of PUBLIC.filter(pageInScope)) jobs.push({
    id: `${size.width}px · signed out · ${path}`, options,
    run: async ({ tab, log, phase }) => {
      await navigate(tab, BASE + path, phase, trackData(tab));
      return { failures: await look(tab, `signed out · ${path}`, phase, log), audits: 1 };
    },
  });
  if (pageInScope("/rewards")) jobs.push({
    id: `${size.width}px · signed out · /rewards (a card)`, options,
    skip: !fixtures.card && prod ? "no card to show yet" : undefined,
    run: async ({ tab, log, phase }) => {
      if (!fixtures.card) throw new Error("the seed has no card with a reward spent");
      await navigate(tab, `${BASE}/rewards?c=${fixtures.card.code}`, phase, trackData(tab));
      await tab.waitForSelector(".tt-rewards", { timeout: 30000 });
      return { failures: await look(tab, "signed out · /rewards (a card)", phase, log), audits: 1 };
    },
  });
  // ── The team ─────────────────────────────────────────────────────────────
  for (const who of CREW) for (const path of who.pages.filter(pageInScope)) jobs.push({
    id: `${size.width}px · ${who.role} · ${path}`, options, timeout: 300000,
    skip: cookies.get(who.role)?.skip,
    run: async job => {
      const auth = cookies.get(who.role);
      if (auth.error) throw auth.error;
      await job.ctx.addCookies([auth.cookie]);
      return teamVisit(job, { who, path, base: BASE, width: size.width });
    },
  });
}
// Separate fixtures let these dialogs be checked without changing another visit's bill.
for (const size of SIZES) for (const screen of SPLIT_SCREENS) {
  const path = screen.role === "diner" ? "/r/_/t/_" : `/dashboard/${screen.door === "bills" ? "bills" : "orders"}`;
  if (!pageInScope(path)) continue;
  for (const lang of screen.role === "diner" ? ["es", "en"] : ["es"]) jobs.push({
    id: `${size.width}px · ${screen.role} ${lang} · ${screen.name}`, options: { viewport: { width: size.width, height: size.height } },
    skip: prod ? "private split fixtures run only in development" : cookies.get(screen.role)?.skip,
    run: async job => {
      if (!prod) {
        const auth = cookies.get(screen.role);
        if (auth?.error) throw auth.error;
        if (auth?.cookie) await job.ctx.addCookies([auth.cookie]);
        const fixture = await splitScreenFixture(admin, fixtures.r.id, screen.state !== "start");
        try {
          await openSplitScreen(job, { fixture, screen, base: BASE, lang });
          return { failures: await look(job.tab, screen.name, job.phase, job.log), audits: 1 };
        } finally { try { await job.tab.close(); } finally { await fixture.cleanup(); } }
      }
      throw new Error("Private split fixtures cannot run against production");
    },
  });
}
const browser = await deadline(30000, () => chromium.launch(), undefined, 5000, "browser launch");
// Against production nothing this gate does may reach the server. It clicks
// dialogs open and walks a diner to the cart, and one click on the wrong
// button is an order in a real restaurant's books — so every write a page
// sends is answered in the browser instead (see hold-writes.mjs) and listed
// at the end.
const held = [];
console.log(`\nLayout — ${prod ? "production" : "development"}; ${concurrency} worker(s)\n`);
let result;
try {
  await assertAuditControl(browser);
  result = await runBrowserJobs(browser, jobs, { concurrency, timings, server, prepare: async (ctx, job) => {
    await isolateMember(ctx, admin, BASE, job.diner, prod);
    if (prod) await holdWrites(ctx, held);
  } });
} finally { await deadline(10000, () => browser.close(), undefined, 5000, "browser close"); }
let failed = result.failures;
/** Dialogs that needed a fresh load to open — said at the end, not hidden. */
const reloads = result.records.reduce((n, r) => n + (r.result?.reloads ?? 0), 0);
/**
 * Which widths each team dialog opened at, and which it did not.
 *
 * A dialog that does not open is skipped, not failed, and that is right for a
 * role without the button. But one that opens at three widths and not at the
 * fourth is not a role without the button: it is a flaky run, or a button the
 * CSS hides at one breakpoint, and both passed. Five of the manager's menu
 * dialogs did exactly that at 390 in one run and the gate said "Everything
 * reads".
 */
const opened = new Map();
for (const record of result.records) for (const dialog of record.result?.dialogs ?? []) {
  const seen = opened.get(dialog.key) ?? { at: [], missed: [] };
  (dialog.open ? seen.at : seen.missed).push(dialog.width);
  opened.set(dialog.key, seen);
}
for (const [key, seen] of opened) {
  if (seen.at.length > 0 && seen.missed.length > 0) {
    failed++;
    console.log(`    BAD      ${key}: opened at ${seen.at.join("/")}px but not at ${seen.missed.join("/")}px`);
  }
}
if (reloads) console.log(`  ${reloads} dialog(s) opened only after the page was loaded again — a worker restart, or a page slow to wire its buttons.`);
if (held.length) {
  console.log(`  Held ${held.length} write(s) the pages tried to send; none reached the server:`);
  for (const w of [...new Set(held)]) console.log(`    ${w}`);
}
console.log(`  Audits: ${result.records.reduce((n, r) => n + (r.result?.audits ?? 0), 0)}`);
timings.report();
console.log(`  Wall time: ${((performance.now() - started) / 1000).toFixed(2)}s`);
reportScope("layout");
console.log(failed === 0 ? "Everything reads.\n" : `${failed} READABILITY PROBLEM(S).\n`);
process.exit(failed === 0 ? 0 : 1);
