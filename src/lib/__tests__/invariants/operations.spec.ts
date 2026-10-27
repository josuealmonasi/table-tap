import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { walkAll, sources, read } from "./helpers";

describe("no probe is left in the repository", () => {
  it("has no *.tmp.* file anywhere it would be committed", () => {
    // A one-off script that signed in as every demo login and called every
    // route was committed with a privacy change and sat at the root for weeks,
    // referenced by nothing. Probes are named *.tmp.* so they can be found.
    const roots = [".", "scripts", "src", "docs", "supabase"];
    const found = roots.flatMap(r =>
      (r === "." ? fs.readdirSync(".").filter(n => fs.statSync(n).isFile()) : walkAll(r)).filter(f => /\.tmp\./.test(f)),
    );
    expect(found, "a probe was left behind — delete it").toEqual([]);
  });
});

describe("the ratings threshold is one number", () => {
  it("keeps MIN_RATINGS_TO_SHOW and the SQL having clause in step", async () => {
    // The constant says "Mirrored in the dish_rating_stats SQL function —
    // change both", and nothing was checking. Worse, nothing imports the
    // constant: the real threshold lives only in SQL, so raising the TS value
    // would look like a change and do nothing at all.
    const { MIN_RATINGS_TO_SHOW } = await import("@/lib/ratings");
    const sql = read("supabase/schema.sql");
    const fn = sql.slice(sql.indexOf("function public.dish_rating_stats"));
    const having = /having count\(\*\) >= (\d+)/.exec(fn.slice(0, 800));

    expect(having, "dish_rating_stats no longer withholds thin averages").toBeTruthy();
    expect(Number(having![1]), "the SQL threshold and the constant disagree").toBe(
      MIN_RATINGS_TO_SHOW,
    );
  });
});

describe("the demo team is one list", () => {
  /** Every `email: "x", … role: "y"` pair a script hard-codes, in file order. */
  const crewIn = (file: string): Map<string, string> => {
    const src = fs.readFileSync(path.join("scripts", file), "utf8");
    const out = new Map<string, string>();
    // The two files write the pair in opposite orders, so match either way.
    for (const m of src.matchAll(
      /email:\s*"([^"]+)"[^}]*?role:\s*"([^"]+)"|role:\s*"([^"]+)"[^}]*?email:\s*"([^"]+)"/g,
    )) {
      const email = m[1] ?? m[4];
      // A request body carries an email and a role too — `POST /api/staff` with
      // `nope@x.dev` is a refusal being tested, not somebody who signs in.
      if (email.endsWith("@tabletap.dev")) out.set(email, m[2] ?? m[3]);
    }
    return out;
  };

  it("gives each demo login the same role in every check that signs in as it", () => {
    // `roles-check` proves who may open what; `layout-check` and `dialog-check`
    // read their crew from `layout-paths`. Two lists of the same five logins,
    // and nothing compared them: rename a demo account in one and the other
    // signs in as somebody else, or fails and blames the app.
    const roles = crewIn("roles-check.mjs");
    const crew = crewIn("layout-paths.mjs");
    expect(roles.size, "roles-check.mjs lists no demo logins — the scan broke").toBeGreaterThan(4);

    const disagree = [...roles]
      .filter(([email, role]) => crew.get(email) !== role)
      .map(([email, role]) => `${email}: roles-check says ${role}, layout-paths says ${crew.get(email) ?? "nothing"}`);
    expect(
      disagree,
      `the same demo login is two different people:\n${disagree.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * A probe is not a script.
 *
 * Throwaway files written to answer one question — audit these grants, log in
 * once, run this SQL — get an underscore prefix and are meant to be deleted the
 * moment they have answered it. Three of them reached main anyway, across three
 * different pull requests, because `git add -A` does not know the difference.
 *
 * They are dead code at best. At worst they are the careless version of the
 * real thing: the ones removed here read env files by hand, hardcoded a demo
 * password, and opened a database connection with none of the care the checked-in
 * scripts take. Left in `scripts/`, they read as examples to copy.
 */
describe("no throwaway probe reaches the repository", () => {
  it("has no underscore-prefixed script committed", () => {
    const stray = fs
      .readdirSync("scripts")
      .filter(f => f.startsWith("_"))
      .map(f => `scripts/${f}`);
    expect(
      stray,
      `these look like one-off probes — delete them, or give them a real name and a place in package.json:\n${stray.join("\n")}`,
    ).toEqual([]);
  });
});

describe("a trial has an end", () => {
  it("never starts one without saying when it stops", () => {
    // `plan_status` defaults to 'trialing' and `trial_ends_at` defaults to
    // nothing, so an insert that mentions neither creates a trial that cannot
    // expire: `expired(null)` is false, `getPlan` never settles it, and the
    // owner reads "Prueba · quedan 0 días" for ever on a plan that is not a
    // trial. /api/admin/users did exactly that.
    //
    // Read out of the INSERT, not out of the file. The first version of this
    // searched the whole source for the word `plan_status`, which meant the
    // comment explaining the fix satisfied it — I reverted the fix and the
    // guard stayed green.
    const payloadOf = (src: string): string[] => {
      const out: string[] = [];
      for (const m of src.matchAll(/from\(["']restaurants["']\)\s*\.insert\(/g)) {
        // Walk the braces so a nested object does not end the payload early.
        let depth = 0;
        let started = false;
        let text = "";
        for (let i = m.index! + m[0].length; i < src.length; i++) {
          const ch = src[i];
          if (ch === "{") { depth++; started = true; }
          if (started) text += ch;
          if (ch === "}") { depth--; if (depth === 0) break; }
        }
        out.push(text);
      }
      for (const m of src.matchAll(/insert into restaurants\s*\(([^)]*)\)/gi)) out.push(m[1]);
      return out;
    };

    // Settled in a second statement is still settled. The seed builds a
    // restaurant on the top tier so the demo data fits under the limits, then
    // downgrades it — which is also what a real downgrade looks like.
    const settlesLater = (src: string): boolean =>
      /update\s+restaurants[\s\S]{0,200}?\bplan_status\b/i.test(src) ||
      /\.update\(\s*\{[^}]*\bplan_status\b/.test(src);

    const offenders: string[] = [];
    for (const file of walkAll("src").concat(walkAll("scripts"))) {
      if (!/\.(ts|tsx|mjs)$/.test(file) || file.includes("__tests__")) continue;
      const src = read(file);
      if (settlesLater(src)) continue;
      for (const payload of payloadOf(src)) {
        const setsStatus = /\bplan_status\b/.test(payload);
        const setsEnd = /\btrial_ends_at\b/.test(payload);
        const startsTrial = /["']trialing["']/.test(payload);
        if (!setsStatus) offenders.push(`${file} — creates a restaurant with no plan_status`);
        else if (startsTrial && !setsEnd) offenders.push(`${file} — starts a trial with no end date`);
      }
    }
    expect(
      offenders,
      `These create a restaurant without settling what plan it is on:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the demo seeds the same way every time", () => {
  it("never adds a print job the kitchen trigger may already have queued", () => {
    // The demo prints kitchen tickets by itself, so every order still at the
    // pass already has its ticket. The seed's "one ticket already printed"
    // collided with it whenever the newest order happened to be one of those,
    // and failed the whole seed half-built — about one run in several.
    const seed = read("scripts/mock-data.mjs");
    const at = seed.indexOf("into print_jobs");
    expect(at, "the seed no longer writes a printed ticket where this looks").toBeGreaterThan(-1);
    expect(seed.slice(at, at + 400), "the seed's ticket can collide with the trigger's")
      .toMatch(/on conflict \(order_id, kind\)/);
  });
});

describe("the stamp button and the stamp are one decision", () => {
  it("shows the scanner only where loyaltyOn says the route will take the stamp", () => {
    // "Sellar tarjeta" on a restaurant whose program is off, or whose plan
    // lacks the card, would be a button into "the visit card is switched off".
    // The screens and the route ask the same function, or they drift.
    for (const page of ["src/app/dashboard/bills/page.tsx", "src/app/dashboard/pos/page.tsx"]) {
      expect(read(page), `${page} decides the scanner by itself`).toMatch(/loyalty=\{await loyaltyOn\(/);
    }
    expect(read("src/app/api/loyalty/stamp/route.ts"), "the stamp route no longer asks loyaltyOn").toMatch(/await loyaltyOn\(/);
    // …and the diner's offer: a card is offered only where the route will make one.
    expect(read("src/lib/menu-shell.ts"), "the diner's offer decides by itself").toMatch(/await loyaltyOn\(/);
    expect(read("src/lib/ordering-data.ts"), "the menu builds its offer some other way").toMatch(/await offeredProgram\(/);
    expect(read("src/app/api/loyalty/card/route.ts"), "the card route no longer asks loyaltyOn").toMatch(/await loyaltyOn\(/);
    for (const screen of ["src/components/dashboard/BillsPanel.tsx", "src/components/dashboard/pos/PosScreen.tsx"]) {
      expect(read(screen), `${screen} shows the scanner without being told to`).toMatch(/\{loyalty &&[^}]*<StampCard/);
    }
  });
});

describe("a visit card's count changes under the card's lock, or not at all", () => {
  it("stamps, redeems and takes back through the locked functions, never a bare write", () => {
    // Taking back a stamp was a bare delete, checked only for the day: a stamp
    // a reward had just been spent on could be taken back, and the card was
    // left owing a visit — a count below zero that every screen showed as
    // nought. The three writes that move a card's count each go through a
    // function that locks the card first, so none of them races another.
    const routes = walkAll("src/app/api").filter(f => f.endsWith(".ts"));
    const bare = routes.filter(f =>
      /from\("loyalty_(visits|redemptions)"\)\s*\.(delete|insert|update|upsert)\(/.test(read(f)));
    expect(bare, "a route writes visits or rewards directly").toEqual([]);
    expect(read("src/app/api/loyalty/visit/route.ts")).toMatch(/rpc\("loyalty_unstamp"/);
    const schema = read("supabase/schema.sql");
    const unstamp = /function public\.loyalty_unstamp[\s\S]*?\$\$;/.exec(schema)?.[0] ?? "";
    expect(unstamp, "loyalty_unstamp does not lock the card").toMatch(/from loyalty_cards c where c\.id = v_card for update/);
    expect(unstamp, "loyalty_unstamp no longer refuses a stamp a reward was spent after").toMatch(/return 'spent'/);
  });
});

describe("a restaurant's plan has one writer at a time", () => {
  it("writes the plan or its subscription only over the sync revision it read", () => {
    // The Stripe sync and the platform admin's plan move both write
    // restaurants.plan. The sync wrote over the revision it had read; the
    // move did not, so an owner subscribing in the seconds between the move's
    // read and its write had a live, paid subscription unlinked from the
    // restaurant, on a plan they were no longer billed for.
    const writes: string[] = [];
    for (const file of walkAll("src").filter(f => /\.tsx?$/.test(f) && !f.includes("__tests__"))) {
      const src = read(file);
      for (const m of src.matchAll(/\.from\("restaurants"\)[\s\S]{0,200}?\.update\(\{([\s\S]*?)\}\)([\s\S]*?);/g)) {
        const [, payload, chain] = m;
        if (!/\b(plan|plan_status|stripe_subscription_id)\s*:/.test(payload)) continue;
        writes.push(file);
        expect(/subscription_sync_revision\s*:/.test(payload) && /\.eq\("subscription_sync_revision"/.test(chain),
          `${file}: writes a restaurant's plan without moving the sync revision AND requiring the one it read`).toBe(true);
      }
    }
    expect(writes.length, "the scan found no plan write — it broke").toBeGreaterThanOrEqual(2);
  });
});

describe("a tier without the feature takes nothing off a sale", () => {
  it("reads promotions through promotionsOnSale and coupons through findCoupon", () => {
    // Only creating a promotion or a coupon asked the plan. The saved ones went
    // on discounting at checkout, the till and the bill after a move to a tier
    // without them. Everything that shows or prices a sale now reads through
    // the two functions that ask; the dashboard's own list is the exception,
    // because it has to show the owner what is saved.
    const allowed = new Set([
      "src/lib/promotions-data.ts",
      "src/lib/promotions-on-sale.ts",
      "src/hooks/usePromotions.ts",
    ]);
    const bare = sources.filter(f => !allowed.has(f) && /\bfetchPromotions\(/.test(read(f)));
    expect(bare, "a sale path that reads promotions without asking the plan").toEqual([]);

    const onSale = sources.filter(f => /\bpromotionsOnSale\(/.test(read(f)) && f !== "src/lib/promotions-on-sale.ts");
    expect(onSale.length, "the scan found no sale path").toBeGreaterThanOrEqual(4);

    // A coupon read straight from the table is one findCoupon never saw.
    const direct = sources.filter(f =>
      /\.from\("coupons"\)/.test(read(f)) &&
      f.startsWith("src/app/api/") &&
      !f.startsWith("src/app/api/coupons/") &&
      !/couponInPlan\(|findCoupon\(/.test(read(f)),
    );
    expect(direct, "a route that reads coupons without asking the plan").toEqual([]);
  });
});

describe("a coupon lookup that failed is not an unknown code", () => {
  it("catches findCoupon's throw at every call and answers it as a retry", () => {
    // findCoupon throws when the read fails. Read as null, a blip told a diner
    // a code from the restaurant's own flyer did not exist, and they paid full
    // price; at checkout the cart dropped the coupon as well.
    const calls = sources
      .filter(f => f !== "src/lib/coupon-service.ts")
      .flatMap(f => read(f).split("\n").map((line, i) => ({ f, i, line })))
      .filter(({ line }) => /\bfindCoupon\(/.test(line) && !/^\s*(\/\/|\*|import)/.test(line));
    expect(calls.length, "the scan found no lookup").toBeGreaterThanOrEqual(5);
    const bare = calls
      .filter(({ line }) => !/\.catch\(\(\) => undefined\)/.test(line))
      .map(({ f, i }) => `${f}:${i + 1}`);
    expect(bare, "a coupon lookup whose failure would read as 'not found'").toEqual([]);
  });
});

describe("the docs do not count what the code decides", () => {
  it("states no number of routes, dialogs or tables that the code can outgrow", () => {
    // CLAUDE.md said the API gate covered "34 API routes", the spec "48"; there
    // were 61. A count in prose is right the day it is written. The gates and
    // the invariants are what say "every one", and they cannot drift.
    const docs = ["CLAUDE.md", "README.md", "docs/SPEC.md"];
    const number = String.raw`(\d{2,}|(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(-[a-z]+)?|ten|eleven|twelve|[a-z]+teen)`;
    const countPattern = new RegExp(String.raw`\b${number}\s+(API\s+)?(routes|dialogs|overlays|tenant tables|screens|pages)\b`, "i");
    const counted = docs.flatMap(f =>
      read(f).split("\n").flatMap((line, i) =>
        countPattern.test(line) ? [`${f}:${i + 1}  ${line.trim()}`] : []));
    expect(counted, "a count of something the code decides — say \"every\" and let a gate enforce it").toEqual([]);
  });
});

describe("a visit card is made only from inside the restaurant", () => {
  it("the card route takes a pass it signed, spends it once and counts its place, before it makes a card", () => {
    // It used to take the restaurant's id alone — printed on every QR — so
    // anybody could fill an owner's program with cards nobody carries.
    const route = read("src/app/api/loyalty/card/route.ts");
    const insert = route.indexOf('.from("loyalty_cards").insert(');
    expect(insert, "the card route no longer makes cards where this looks").toBeGreaterThan(-1);
    for (const step of ["readVisitPass(restaurantId, body?.pass)", "`loyalty-pass:${pass.nonce}`", "placeLimit(restaurantId, pass.place)"]) {
      const at = route.indexOf(step);
      expect(at, `the card route lost ${step}`).toBeGreaterThan(-1);
      expect(at, `${step} comes after the card is made`).toBeLessThan(insert);
    }
  });

  it("every page that offers the card hands it a pass for its own place, and the phone sends it", () => {
    expect(read("src/lib/ordering-data.ts")).toMatch(/pass: issueVisitPass\(restaurantId, "counter"\)/);
    expect(read("src/app/r/[restaurantId]/t/[tableId]/page.tsx")).toContain('pass: ""');
    expect(read("src/app/api/table-membership/route.ts")).toContain('state.status === "approved"');
    expect(read("src/app/api/table-membership/route.ts")).toContain('issueVisitPass(restaurantId, { table: tableId, session: state.sessionId })');
    expect(read("src/app/order/[orderId]/page.tsx")).toMatch(/offerAt\(data\.loyalty, \{ order: /);
    expect(read("src/components/customer/LoyaltyOffer.tsx")).toMatch(/pass: offer\.pass/);
  });
});
