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
import { CREW, SPLIT_SCREENS } from "./layout-paths.mjs";
import { changedParts, fingerprint, holdWrites } from "./hold-writes.mjs";
import { watchDevWorker } from "./preflight.mjs";
import { DEV_URL } from "./dev-url.mjs";
import { pageInScope, reportScope } from "./gate-scope.mjs";
import { browserConcurrency, phaseTimings, runBrowserJobs } from "./browser-jobs.mjs";
import { crewCookies } from "./browser-fixtures.mjs";
import { probeDialogs, typingFaults } from "./dialog-probe.mjs";
import { assertAuditControl, look } from "./browser-audit.mjs";

import { splitScreenFixture, openSplitScreen } from "./split-slot-screens.mjs";
import { deadline, runWatchdog } from "./browser-deadline.mjs";
import { monitorBrowserServer } from "./browser-server.mjs";

runWatchdog("dialogs");
const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));
const BASE = prod ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app") : DEV_URL;
watchDevWorker(BASE);
const server = prod ? null : monitorBrowserServer(BASE);
process.on("exit", () => { server?.stop(); server?.report(); });
const concurrency = browserConcurrency();
const timings = phaseTimings();
const started = performance.now();
// The narrow end of the phone band, not the iPhone: no breakpoint falls
// between 360 and 390, so 360 is the same rules with 30px less room, and the
// harder of the two. `pnpm layout` still measures 390.
const WIDTHS = [360, 1280];

// What the sweep is about to click through, fingerprinted with the secret key
// so it can be compared once the sweep is over. See hold-writes.mjs.
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DEMO = "Demo Bistro";
const before = await fingerprint(admin, DEMO);
const held = [];

const cookies = await crewCookies(CREW.filter(w => w.pages.some(pageInScope)), BASE, timings.phase);
const jobs = WIDTHS.flatMap(width => CREW.flatMap(who => who.pages.filter(pageInScope).map(path => ({
  id: `${width}px · ${who.role} · ${path}`,
  options: { viewport: { width, height: 900 }, locale: "es-MX" },
  skip: cookies.get(who.role)?.skip,
  // Every button gets 20s, plus navigation and readiness for the visit.
  timeout: 600000,
  run: async job => {
    const auth = cookies.get(who.role);
    if (auth.error) throw auth.error;
    await job.ctx.addCookies([auth.cookie]);
    return probeDialogs(job, { url: BASE + path, role: who.role, path });
  },
}))));
// The nested cash and tip fields are exercised in each collection door, as every collector.
const { data: splitRestaurant, error: splitRestaurantError } = await admin.from("restaurants").select("id").eq("name", DEMO).single();
if (splitRestaurantError) throw new Error(splitRestaurantError.message);
for (const width of WIDTHS) for (const screen of SPLIT_SCREENS) {
  const path = screen.role === "diner" ? "/r/_/t/_" : `/dashboard/${screen.door === "bills" ? "bills" : "orders"}`;
  if (!pageInScope(path)) continue;
  jobs.push({ id: `${width}px · ${screen.role} · ${screen.name}`, options: { viewport: { width, height: 900 } },
    skip: prod ? "private split fixtures run only in development" : cookies.get(screen.role)?.skip,
    run: async job => {
      if (!prod) {
        const auth = cookies.get(screen.role);
        if (auth?.error) throw auth.error;
        if (auth?.cookie) await job.ctx.addCookies([auth.cookie]);
        const fixture = await splitScreenFixture(admin, splitRestaurant.id, screen.state !== "start");
        try {
          await openSplitScreen(job, { fixture, screen, base: BASE });
          const failures = await look(job.tab, screen.name, job.phase, job.log);
          const faults = await typingFaults(job.tab);
          for (const fault of faults) job.log(`    BAD      ${screen.name}: ${fault}`);
          await job.tab.keyboard.press("Escape");
          await job.tab.locator("[role=dialog]").waitFor({ state: "hidden" });
          return { failures: failures + faults.length, opened: 1, fieldChecks: 1 };
        } finally { try { await job.tab.close(); } finally { await fixture.cleanup(); } }
      }
      throw new Error("Private split fixtures cannot run against production");
    },
  });
}
const browser = await deadline(30000, () => chromium.launch(), undefined, 5000, "browser launch");
console.log(`\nDialogs — ${prod ? "production" : "development"}; ${concurrency} worker(s)\n`);
let result;
try {
  await assertAuditControl(browser);
  result = await runBrowserJobs(browser, jobs, { concurrency, timings, server,
    prepare: async ctx => { ctx.setDefaultTimeout(30000); await holdWrites(ctx, held); },
  });
} finally {
  await deadline(10000, () => browser.close(), undefined, 5000, "browser close");
}
let failed = result.failures;
const opened = result.records.reduce((n, r) => n + (r.result?.opened ?? 0), 0);
console.log(`  Page-field checks: ${result.records.reduce((n, r) => n + (r.result?.fieldChecks ?? 0), 0)}`);
// Held back is fine — that is a button doing its job with nobody listening. A
// change that got through anyway is not: it is the seed another gate reads.
console.log(`\n  ${held.length} write(s) held back in the browser.`);
const moved = changedParts(before, await fingerprint(admin, DEMO));
if (moved.length) {
  failed++;
  console.log(`  BAD      the sweep changed ${DEMO}'s data anyway: ${moved.join(", ")}`);
}

timings.report();
console.log(`  Wall time: ${((performance.now() - started) / 1000).toFixed(2)}s`);

reportScope("dialogs");
console.log(
  failed === 0
    ? `\nAll ${opened} dialogs read.\n`
    : `\n${failed} of ${opened} DIALOGS DO NOT READ.\n`,
);
process.exit(failed === 0 ? 0 : 1);
