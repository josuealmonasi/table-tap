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
const bad = m => { failed++; console.log(`    BAD      ${m}`); };

console.log(`\nRequests — ${prod ? "production" : "development"}\n`);

const fx = await setup(process.env, BASE);
// What one case leaves for the next: the coupon that gets created is the one
// later switched off and deleted.
const saved = {};
try {
  for (const c of cases(fx)) {
    const headers = { "Content-Type": "application/json" };
    if (c.as !== "diner") headers.cookie = fx.who[c.as];

    // Some refusals only exist on the far side of a switch. `/api/split/pay`
    // turns everybody away when the restaurant has no card reader, and no
    // seeded restaurant has one — so its case for "no such split" was being
    // answered "this restaurant cannot take cards", passed on the status code
    // alone, and had never once tested the thing it is named after.
    //
    // `arrange` puts the switch where the case needs it and hands back the
    // undo, which runs whatever the case does — including throwing.
    let restore = null;
    if (c.arrange) restore = await c.arrange(fx);

    // `continue` runs a `finally` on its way out, which is what makes this
    // safe: every way this loop body ends — a refusal, a bad status, a thrown
    // request — puts the switch back before the next case runs.
    try {
    let res, text;
    try {
      // A path may be a function for the same reason a body may: some of what
      // a case has to address is only known once the fixture exists — a
      // printer's token, the id of the job it was handed.
      const path = typeof c.path === "function" ? await c.path(fx, saved) : c.path;
      res = await retryFetch(
        BASE + path,
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
      bad(`${c.name} — ${res.status}, expected ${c.expect.join("/")}  ${text.slice(0, 90)}`);
      continue;
    }

    // A refusal has to be the RIGHT refusal.
    //
    // Several routes answer 409 for more than one reason, so a case that only
    // checks the status can be satisfied by a refusal it never meant to test.
    // Three of `/api/split/pay`'s own cases were: "no such split" and "a share
    // already paid" both passed while being handed "this restaurant cannot
    // take cards", because that is a 409 too. Matching the sentence is what
    // tells them apart.
    if (c.expectError) {
      let message = "";
      try { message = JSON.parse(text).error ?? ""; } catch { message = text; }
      if (!c.expectError.test(message)) {
        bad(`${c.name} — ${res.status} with the wrong refusal: ${JSON.stringify(message.slice(0, 70))}`);
        continue;
      }
    }

    // The right status with the wrong body is still a failure: that is how an
    // endpoint returning 200 and `saved: 0` got through.
    if (c.check && res.status === 200) {
      let data;
      try { data = JSON.parse(text); } catch { data = {}; }
      // The fixture goes with it, so a case can check what the route DID and
      // not only what it said: a write-off answers `{ ok: true }` either way,
      // and what matters is the state it left the orders in.
      const verdict = await c.check(data, fx);
      if (verdict !== true) {
        bad(`${c.name} — answered 200 but ${verdict}`);
        continue;
      }
    }
    // Same idea for a route that does not answer JSON: the QR is an image, and
    // an empty 200 there is a camera pointed at nothing.
    if (c.checkText && res.status === 200) {
      const verdict = c.checkText(text);
      if (verdict !== true) {
        bad(`${c.name} — answered 200 but ${verdict}`);
        continue;
      }
    }
    if (c.save && res.status === 200) {
      try { Object.assign(saved, c.save(JSON.parse(text))); } catch { /* sin cuerpo */ }
    }
    ok(`${c.name}${c.expect.length > 1 ? ` (${res.status})` : ""}`);
    } finally {
      if (restore) await restore();
    }
  }
} finally {
  await teardown(fx);
}

console.log(failed === 0 ? "\nEvery request answers.\n" : `\n${failed} PROBLEM(S).\n`);
process.exit(failed === 0 ? 0 : 1);
