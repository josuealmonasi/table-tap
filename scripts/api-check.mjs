// ============================================================================
// TableTap — does every request actually work?
//
// What we already had checked the edges: `rls` who gets refused, `roles` who
// opens each screen, `invariants` that every route has a guard, `layout` that
// it can be read, `smoke` that the page paints. None called an endpoint with a
// legitimate request to see whether it does its job. This one does, on all 34.
//
// A 500 is never right. A specific refusal — 409 with no Stripe account, 400
// for missing data — is the route working, which is why `expect` is a list.
//
//   pnpm api
//   pnpm api --prod
// ============================================================================
import { join } from "node:path";
import { setup, teardown } from "./api-fixtures.mjs";
import { cases } from "./api-cases.mjs";
import { requireServer, retryFetch } from "./preflight.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));
const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";

await requireServer(BASE, prod);

let failed = 0;
const ok = m => console.log(`    ok       ${m}`);
const bad = m => { failed++; console.log(`    MAL      ${m}`); };

console.log(`\nRequests — ${prod ? "production" : "development"}\n`);

const fx = await setup(process.env, BASE);
// What one case leaves for the next: the coupon that gets created is the one
// later switched off and deleted.
const saved = {};
try {
  for (const c of cases(fx)) {
    const headers = { "Content-Type": "application/json" };
    if (c.as !== "diner") headers.cookie = fx.who[c.as];

    let res, text;
    try {
      res = await retryFetch(
        BASE + c.path,
        {
          method: c.method,
          headers,
          body:
            c.body === undefined
              ? undefined
              : JSON.stringify(typeof c.body === "function" ? await c.body(fx, saved) : c.body),
        },
        BASE,
      );
      text = await res.text();
    } catch (e) {
      bad(`${c.name} — no answer: ${e.message}`);
      continue;
    }

    if (!c.expect.includes(res.status)) {
      // Some routes depend on something not yet subscribed to. It is reported on
      // every run without failing the check: a test that is always red over
      // something the code cannot fix is a test people ignore, and then it hides
      // the ones that matter.
      if (c.known) {
        console.log(`    –        ${c.name} — ${c.known} (${res.status})`);
        continue;
      }
      bad(`${c.name} — ${res.status}, esperaba ${c.expect.join("/")}  ${text.slice(0, 90)}`);
      continue;
    }

    // The right status with the wrong body is still a failure: that is how an
    // endpoint returning 200 and `saved: 0` got through.
    if (c.check && res.status === 200) {
      let data;
      try { data = JSON.parse(text); } catch { data = {}; }
      const verdict = c.check(data);
      if (verdict !== true) {
        bad(`${c.name} — answered 200 but ${verdict}`);
        continue;
      }
    }
    if (c.save && res.status === 200) {
      try { Object.assign(saved, c.save(JSON.parse(text))); } catch { /* sin cuerpo */ }
    }
    ok(`${c.name}${c.expect.length > 1 ? ` (${res.status})` : ""}`);
  }
} finally {
  await teardown(fx);
}

console.log(failed === 0 ? "\nEvery request answers.\n" : `\n${failed} PROBLEM(S).\n`);
process.exit(failed === 0 ? 0 : 1);
