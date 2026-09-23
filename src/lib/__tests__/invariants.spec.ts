import { describe, expect, it } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import path from "node:path";
import { en } from "@/lib/i18n/en";

/**
 * Rules that span more than one file, with nothing else to enforce them.
 *
 * Every bug these came from was the same shape: two places that had to agree,
 * and nothing checking that they did. A reviewer cannot hold that in their
 * head across a large change, and none of it shows up as a type error — the
 * code compiles perfectly while the staff screen says a table owes MX$105 and
 * the diner's screen says it owes nothing.
 *
 * Each test below is a bug that actually shipped. Adding to this file is the
 * cheapest thing to do after finding the next one.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !full.includes("__tests__")) out.push(full);
  }
  return out;
}

/** Every file under a directory, whatever its name. */
function walkAll(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAll(full, out);
    else out.push(full);
  }
  return out;
}

const schema = fs.readFileSync("supabase/schema.sql", "utf8");
const sources = walk("src");
const read = (f: string) => fs.readFileSync(f, "utf8");

describe("a new table decides whether the world can read it", () => {
  it("locks down or explicitly grants every table created after the blanket revoke", () => {
    // `revoke all on all tables in schema public from anon` runs once, partway
    // down the file. A table created after it is NOT covered — it is created
    // with whatever Postgres grants by default, and the revoke has already
    // happened. The rate_limits table shipped that way once.
    const cut = schema.indexOf("revoke all on all tables in schema public from anon");
    expect(cut, "the blanket revoke has moved or gone").toBeGreaterThan(0);

    const later = [...schema.slice(cut).matchAll(/create table if not exists ([a-z_]+)/g)].map(
      m => m[1],
    );
    expect(later.length).toBeGreaterThan(0);

    const undecided = later.filter(
      t =>
        !new RegExp(`revoke all on ${t} from anon`).test(schema) &&
        !new RegExp(`grant [a-z ,()_\\n]*on ${t} to anon`).test(schema),
    );
    expect(undecided, `no anon decision for: ${undecided.join(", ")}`).toEqual([]);
  });
});

describe("dialogs do not stack", () => {
  it("never renders a dialog inside another dialog", () => {
    // Two open dialogs run two focus traps against each other and take two
    // Escapes to leave. This shipped three times: the receipt prompt over the
    // tracker, the write-off reason over the settle sheet, and again over the
    // bill discount dialog. The fix each time is to render the second as a
    // sibling and close the first.
    const offenders: string[] = [];
    for (const file of sources) {
      const body = read(file);
      for (const block of body.matchAll(/<Modal\b[^>]*>([\s\S]*?)<\/Modal>/g)) {
        for (const nested of new Set(
          [...block[1].matchAll(/<([A-Z][A-Za-z]*(?:Dialog|Sheet|Prompt))\b/g)].map(m => m[1]),
        )) {
          offenders.push(`${file}: <${nested}>`);
        }
      }
    }
    expect(offenders, `nested dialogs: ${offenders.join("; ")}`).toEqual([]);
  });
});

describe("money that stops being owed closes the sitting", () => {
  it("closes the sitting wherever an order is marked paid or written off", () => {
    // A sitting that never closes holds its table occupied and keeps the diner
    // bound to it forever. There is no single chokepoint — a card, cash at the
    // table and a write-off are three routes to the same empty table — so each
    // one has to do it.
    // Only a route that SETTLES something: `paid: true` inside an `.update()`,
    // which is an order that was owed and now is not. A counter sale inserts a
    // row already paid, with no table and no sitting — there was never
    // anything holding a table to close. Matching the whole file rather than
    // the call is what made that look like the same act.
    const settlesExisting = /\.update\(\s*\{[\s\S]*?(paid:\s*true|written_off:\s*true)/;
    const clearing = sources.filter(f => settlesExisting.test(read(f)));
    expect(clearing.length).toBeGreaterThan(0);

    const missing = clearing.filter(f => !/closeSession/.test(read(f)));
    expect(missing, `clears a debt without closing the sitting: ${missing.join(", ")}`).toEqual(
      [],
    );
  });
});

describe("every public endpoint has a ceiling", () => {
  it("guards or rate limits every API route", () => {
    // An endpoint with neither is open to the world with no limit. Found one
    // this way: order-status had been public and unlimited since it was
    // written, while every other public route had a limit.
    const routes = walk("src/app/api").filter(f => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThan(10);

    const naked = routes.filter(
      f =>
        !/acting(Staff|FrontOfHouse|Manager|Owner)|isRateLimited|getPlatformAdmin|stripe-signature|readStripeEvent/.test(
          read(f),
        ),
    );
    expect(naked, `no guard and no rate limit: ${naked.join(", ")}`).toEqual([]);
  });
});

describe("each module sits behind the right guard", () => {
  // A module moved from one screen to another inherits that screen's audience.
  // The history moved out of the orders board — which the kitchen can open —
  // and into analytics; the activity log moved out of staff, which only the
  // owner can open, and into bills, which a waiter can open. Getting the host
  // right is the whole permission story, and nothing in the types says so.
  const HOSTED_BY = {
    OrderHistory: "src/components/dashboard/analytics/AnalyticsView.tsx",
    // The log comes in as children from the page, not from inside the panel.
    UserLogs: "src/app/dashboard/bills/page.tsx",
  };

  it.each(Object.entries(HOSTED_BY))("%s is rendered by its new host", (mod, host) => {
    expect(read(host), `${host} no longer renders ${mod}`).toMatch(new RegExp(`<${mod}[\\s/>]`));
  });

  it("does not leave the old host rendering it too", () => {
    // Two copies is how one of them keeps an audience it lost.
    const old = {
      OrderHistory: "src/components/dashboard/OrdersBoard.tsx",
      UserLogs: "src/components/dashboard/staff/StaffPanel.tsx",
    };
    for (const [mod, file] of Object.entries(old)) {
      expect(read(file), `${file} still renders ${mod}`).not.toMatch(new RegExp(`<${mod}[\\s/>]`));
    }
  });

  it("gates the activity log with exactly what its RLS policy allows", () => {
    // The page's gate and the table's policy are two places that have to say the
    // same thing, and nothing compared them: the page showed the activity log to
    // the manager and `user_logs` only lets the owner read it, so the manager saw
    // the whole module with zero rows. A gate wider than its policy protects
    // nothing extra — it shows a broken screen.
    const page = read("src/app/dashboard/bills/page.tsx");
    const schema = read("supabase/schema.sql");
    // The statement spans several lines: take it from `create policy` to its
    // semicolon, which is where it actually ends.
    const policy = schema
      .split(";")
      .find(stmt => /create policy/.test(stmt) && /\bon user_logs\b/.test(stmt));

    expect(policy, "no encuentro la política de user_logs en schema.sql").toBeTruthy();
    // `owns_restaurant` is owner; `has_role(..., 'manager')` would be owner and
    // manager. What the policy says decides the page's predicate.
    const ownerOnly = /owns_restaurant/.test(policy!);
    expect(page).toMatch(ownerOnly ? /OWNS\(membership\.role\)/ : /MANAGES\(membership\.role\)/);
    // And never the other, which is how we got here.
    expect(page).not.toMatch(ownerOnly ? /MANAGES\(membership\.role\) && \(\s*<UserLogs/ : /OWNS\(membership\.role\) && \(\s*<UserLogs/);
  });
});

describe("what the customer page reads, the customer may read", () => {
  it("grants anon every restaurant column the ordering page selects", () => {
    // Three places have to agree on one list: the select in ordering-data, the
    // column grant in schema.sql, and the checkout route's own select. Adding
    // a setting to the first and forgetting the second gives a column that is
    // simply null in the browser — no error anywhere, the feature just never
    // turns on. That is how this file's rule reads: two places that must agree
    // with nothing checking.
    const select = read("src/lib/ordering-data.ts").match(
      /"(id, name, tagline[^"]*)"/,
    );
    expect(select, "the ordering select moved or changed shape").toBeTruthy();
    const wanted = select![1].split(",").map(c => c.trim());

    const schema = read("supabase/schema.sql");
    const grant = schema.match(/grant select \(([^)]*)\) on restaurants to anon;/);
    expect(grant, "the anon column grant on restaurants is gone").toBeTruthy();
    const granted = new Set(grant![1].split(",").map(c => c.trim()));

    const missing = wanted.filter(c => !granted.has(c));
    expect(missing, `read by the menu but not granted to anon: ${missing.join(", ")}`).toEqual(
      [],
    );
  });
});

describe("a price reads the same everywhere", () => {
  it("does not depend on the machine's locale", async () => {
    // The bug this pins: `Intl.NumberFormat(undefined, …)` gave the server one
    // string and the browser another, so every price on the menu was a
    // hydration mismatch and React re-rendered the entire customer page.
    const { formatMoney } = await import("@/lib/format");
    expect(formatMoney(23, "MXN")).toBe("MX$23.00");
    expect(formatMoney(14.9, "USD")).toBe("$14.90");
  });
});

describe("a role is known everywhere or nowhere", () => {
  it("offers every role in the staff picker and accepts it at the API", async () => {
    // A role can exist in the type, pass the database's check constraint, and
    // still be unusable: `getMembership` fell back to `kitchen` for `cashier`
    // because its own list hadn't heard of it, so the new role silently lost
    // the bills screen. The list is derived from one constant now — this keeps
    // the places that repeat it by hand in step.
    const { ROLES } = await import("@/lib/membership");
    const hired = ROLES.filter(r => r !== "owner");

    const api = read("src/app/api/staff/route.ts");
    for (const role of ROLES) {
      expect(api, `POST /api/staff refuses "${role}"`).toContain(`"${role}"`);
    }

    const picker = read("src/components/dashboard/staff/StaffPanel.tsx");
    for (const role of hired) {
      expect(picker, `no way to hire a "${role}"`).toContain(`value="${role}"`);
    }

    const schema = read("supabase/schema.sql");
    const check = schema.match(/staff_role_check\s*\n?\s*check \(role in \(([^)]*)\)\)/);
    expect(check, "the staff role constraint moved").toBeTruthy();
    for (const role of ROLES) {
      expect(check![1], `the database rejects "${role}"`).toContain(`'${role}'`);
    }
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

describe("a zero platform fee is never sent to Stripe", () => {
  it("omits application_fee_amount on every card path", () => {
    // Stripe refuses an application fee of 0. Grupo charges no per-order fee,
    // and a pilot restaurant we don't bill is the same case — so a route that
    // passes the fee unconditionally works for everyone except the restaurants
    // we most want to keep happy. /api/checkout guarded it; /api/bill/pay did
    // not, and card orders would go through while paying the table's bill died.
    for (const file of ["src/app/api/checkout/route.ts", "src/app/api/bill/pay/route.ts"]) {
      const body = read(file);
      const uses = body.includes("application_fee_amount");
      expect(uses, `${file} no longer sets an application fee`).toBe(true);
      expect(
        /appFee > 0 \? \{ application_fee_amount/.test(body),
        `${file} sends application_fee_amount even when it is zero`,
      ).toBe(true);
    }
  });
});

describe("a combo survives the trip to the server", () => {
  it("sends comboId and components with the cart", () => {
    // The checkout payload is an explicit whitelist, which is right — the
    // server has no business seeing `cartId`. But it was missing the two
    // fields that make a combo a combo, so every bundle arrived as a loose
    // line whose itemId is a promotion id. The server looked it up among the
    // dishes, found nothing, and told the diner it was no longer available.
    // Combos could not be ordered at all, and they are a paid-tier feature.
    const app = read("src/components/customer/OrderingApp.tsx");
    const payload = app.slice(app.indexOf("items: orderableItems.map"));
    expect(payload.slice(0, 600)).toContain("comboId");
    expect(payload.slice(0, 600)).toContain("components");
  });
});

describe("a column exists before the grant that names it", () => {
  it("keeps reserve_stock locking the rows it counts", () => {
    // The whole promise of the stock count is that two diners cannot both be
    // sold the last portion, and the only thing delivering it is the row lock
    // inside reserve_stock. Ten simultaneous attempts on one portion produce
    // exactly one winner — verified by hand against a real database, which is
    // the sort of proof that rots the moment somebody edits the function.
    //
    // This cannot re-run that race without a database, so it guards the two
    // lines the race depends on: the lock, and the deterministic order that
    // stops two overlapping carts deadlocking against each other. Losing
    // either silently turns overselling back on.
    const sql = read("supabase/schema.sql");
    const fn = sql.slice(
      sql.indexOf("create or replace function public.reserve_stock"),
      sql.indexOf("grant execute on function public.reserve_stock"),
    );
    expect(fn, "reserve_stock is not in schema.sql").not.toBe("");
    expect(fn.includes("for update"), "reserve_stock no longer locks the rows it reads").toBe(
      true,
    );
    expect(
      /order by m\.id\s*\n\s*for update/.test(fn),
      "reserve_stock locks without a deterministic order — two carts can deadlock",
    ).toBe(true);
  });

  it("gives back stock wherever a reserved order stops being an order", () => {
    // Reserving at checkout is only safe because every way out hands the stock
    // back. A new exit that forgets to is an order's worth of food sold to
    // nobody, and nothing else would notice.
    // Looking for a CALL, not the name: the import line alone would satisfy
    // `includes("releaseStock")` long after somebody deleted the call under
    // it, which is exactly the shape of the bug this is here to catch.
    const calls = (file: string): number =>
      read(file)
        .split("\n")
        .filter(l => !l.trimStart().startsWith("import"))
        .filter(l => /\breleaseStock\s*\(/.test(l)).length;

    expect(
      calls("src/lib/checkout-settle.ts"),
      "an abandoned checkout no longer returns its stock",
    ).toBeGreaterThan(0);
    expect(
      calls("src/app/api/orders/cancel/route.ts"),
      "a cancelled order no longer returns its stock",
    ).toBeGreaterThan(0);
    expect(
      calls("src/app/api/checkout/route.ts"),
      "a checkout that falls over no longer returns what it reserved",
    ).toBeGreaterThan(0);
  });

  it("creates every granted column earlier in schema.sql than its grant", () => {
    // schema.sql runs top to bottom, and the column grants sit a few hundred
    // lines above where new columns naturally get appended. Adding one the
    // obvious way and listing it in a grant fails the whole migration with
    // `column "…" does not exist` — which is loud, but only after you have run
    // it. The file already warns about this ordering twice; this checks it.
    const sql = read("supabase/schema.sql");

    const created = (table: string, column: string): number => {
      const alter = sql.indexOf(
        `alter table ${table} add column if not exists ${column} `,
      );
      if (alter !== -1) return alter;
      // Otherwise it has to be in the table's own CREATE block.
      const start = sql.indexOf(`create table if not exists ${table} (`);
      if (start === -1) return -1;
      const end = sql.indexOf("\n);", start);
      const block = sql.slice(start, end);
      return new RegExp(`^\\s+${column}\\s`, "m").test(block) ? start : -1;
    };

    const grants = [...sql.matchAll(/grant select \(([^)]*)\) on (\w+) to/g)];
    expect(grants.length, "the column grants moved or vanished").toBeGreaterThan(0);

    const late: string[] = [];
    for (const grant of grants) {
      const [, columns, table] = grant;
      for (const raw of columns.split(",")) {
        const column = raw.trim();
        const at = created(table, column);
        if (at === -1 || at > grant.index!) late.push(`${table}.${column}`);
      }
    }
    expect(late, `granted before they are created: ${late.join(", ")}`).toEqual([]);
  });
});

describe("which QR the diner came in through is never assumed", () => {
  it("hands paymentOptions a real atTable rather than a literal", () => {
    // Paying at the till is defined as "no table is holding this order", so a
    // hardcoded `atTable: true` in the caller makes that option unreachable
    // however the restaurant is configured. That shipped: an owner with
    // "pay at the end / at the counter" switched on and no Stripe account saw
    // their general QR hand the diner a cart with no button on it at all and a
    // line saying the restaurant could not take cards. Only the screen holding
    // the table knows the answer, so only it may supply it.
    const guilty: string[] = [];
    for (const file of sources) {
      for (const call of read(file).match(/paymentOptions\(\{[^}]*\}/g) ?? []) {
        if (/atTable:\s*(true|false)\b/.test(call)) guilty.push(file);
      }
    }
    expect(guilty, `decides atTable for itself: ${guilty.join(", ")}`).toEqual([]);
  });
});

/**
 * The harness only ever checks what is on its lists.
 *
 * `pnpm api` opens `api-cases.mjs` and `pnpm layout` opens `layout-paths.mjs`.
 * A route or a screen that nobody adds to those lists is not checked loosely —
 * it is not checked at all, and every gate goes green around the hole. Seven
 * routes and eight pages had accumulated that way, among them the platform
 * admin console, which was unusable on a phone for as long as it had existed
 * while `pnpm layout` reported that everything reads.
 */
describe("the checks know about every route and screen", () => {
  const listed = (file: string): string =>
    fs.readFileSync(path.join("scripts", file), "utf8");

  it("has an api case for every API route", () => {
    const cases = listed("api-cases.mjs");
    const routes = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts"))
      .map(f => f.replace(/^src\/app/, "").replace(/\/route\.ts$/, ""));

    // Every path a case actually requests. Read as text rather than imported,
    // because the file builds most of them from fixtures that do not exist
    // until the server is up.
    const requested = [...cases.matchAll(/path:\s*[`"']([^`"']+)/g)].map(m => m[1]);

    // A dynamic route is one pattern, not one path: `[token]` is filled in at
    // request time, and so is a `${...}` in the case that exercises it. Both
    // sides collapse to "one segment, contents unknown" before they are
    // compared — otherwise the app's first dynamic route is matched by nothing
    // and waved through, which is the exact hole this test exists to close.
    const segment = "[^/?#]+";
    const covered = (route: string): boolean => {
      const pattern = new RegExp(
        "^" +
          route
            .split("/")
            .map(part =>
              /^\[.+\]$/.test(part) ? segment : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            )
            .join("/") +
          "([/?].*)?$",
      );
      return requested.some(path => pattern.test(path.replace(/\$\{[^}]*\}/g, "x")));
    };

    const missing = routes.filter(r => !covered(r));
    expect(
      missing,
      `API routes no case exercises — add one to scripts/api-cases.mjs.\nFor a route that destroys something, assert the refusal it must give rather than running it:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("has a layout path for every page a person can open", () => {
    const paths = listed("layout-paths.mjs");
    const pages = walkAll("src/app")
      .filter(f => f.endsWith("page.tsx"))
      .map(f => f.replace(/^src\/app/, "").replace(/\/page\.tsx$/, "") || "/")
      // A route with a parameter is opened through a flow, with a real id.
      .filter(p => !p.includes("["));

    const missing = pages.filter(p => !paths.includes(`"${p}"`));
    expect(
      missing,
      `Screens nothing measures — add each to CREW or PUBLIC in scripts/layout-paths.mjs:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * No client component can reach a secret.
 *
 * `src/lib/supabase/admin.ts` holds the key that bypasses RLS entirely. What
 * stops it reaching a browser today is a comment saying "SERVER-ONLY. Never
 * import this into a client component" — and five client components already
 * sit two hops away from it through `order-tracking`, `plan-server` and
 * `membership`. All five are `import type`, which the compiler erases, so
 * nothing ships. Change one of them to a value import and the key ships.
 *
 * Walks the real import graph, counting only imports that survive compilation:
 * a type-only import is not an edge, because it is not there at runtime.
 */
/** The source between an opening `(` and its match. */
function callBody(src: string, from: number): string {
  let depth = 1;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(from, i);
  }
  return src.slice(from);
}

describe("what a person is told goes through the dictionaries", () => {
  /** Every .ts/.tsx under src that ships to a browser. */
  const clientFiles = (): string[] =>
    walkAll("src").filter(
      f => /\.tsx?$/.test(f) && !f.includes("__tests__") && !f.includes("/i18n/"),
    );

  const parse = (file: string) =>
    ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

  it("shows no toast written in one fixed language", () => {
    // Two of these sat in the staff screens: an owner reading the dashboard in
    // Spanish changed somebody's role and was told "Role updated". The API
    // errors were fixed the same week and these were missed, because nothing
    // looked anywhere but the routes.
    const offenders: string[] = [];
    for (const file of clientFiles()) {
      const sf = parse(file);
      const visit = (n: ts.Node): void => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          ["toast", "alert"].includes(n.expression.text) &&
          n.arguments.length > 0
        ) {
          const arg = n.arguments[0];
          const written =
            ts.isStringLiteral(arg) ||
            (ts.isTemplateExpression(arg) && !arg.getText().includes("t("));
          if (written && /[A-Za-z]{3}/.test(arg.getText())) {
            const line = sf.getLineAndCharacterOfPosition(arg.getStart()).line + 1;
            offenders.push(`${file}:${line}  ${arg.getText().slice(0, 50)}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(
      offenders,
      `a toast in one fixed language — hand it a key instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("lets no browser request fail in silence", () => {
    // A fetch with nothing catching it does nothing at all when the connection
    // is gone. That is how a status change was thrown away, how signing up
    // spun for ever on a dead network, and how a diner could tap "pay my
    // share" and watch nothing happen — twice, opening two Stripe sessions.
    const offenders: string[] = [];
    for (const file of clientFiles()) {
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes("fetch(")) continue;
      // A server component's failure is a 500, which is loud already.
      if (!text.startsWith('"use client"') && !file.includes("/hooks/")) continue;

      const sf = parse(file);
      const visit = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && n.expression.getText() === "fetch") {
          let p: ts.Node | undefined = n.parent;
          let guarded = false;
          while (p) {
            if (ts.isTryStatement(p)) {
              guarded = true;
              break;
            }
            // Or a .catch() chained onto the promise this fetch starts.
            if (ts.isExpressionStatement(p) && /\.catch\s*\(/.test(p.getText())) {
              guarded = true;
              break;
            }
            p = p.parent;
          }
          if (!guarded) {
            const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
            offenders.push(`${file}:${line}`);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(
      offenders,
      `a browser request with nothing catching it — wrap it, or chain a .catch():\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("each Stripe stream has its own endpoint and its own secret", () => {
  /**
   * The app takes money on two Stripe accounts. A diner's food is a DIRECT
   * charge on the restaurant's own account — the change that stopped Stripe
   * billing us MX$13.80 on a MX$300 ticket against MX$0.75 collected — so
   * those events fire there. A subscription is charged on ours. Stripe has no
   * endpoint that receives both, and issues a separate signing secret for each.
   *
   * The tempting shortcut is one route trying several secrets until one fits.
   * It works, and it also means the code can no longer say which account an
   * event came from: a connected-account settlement arriving on the platform
   * endpoint would be paid out identically. So: one secret per route, and each
   * route handles only its own account's events.
   */
  const PLATFORM = "src/app/api/webhooks/stripe/route.ts";
  const CONNECT = "src/app/api/webhooks/stripe/connect/route.ts";

  it("verifies each endpoint against exactly one secret", () => {
    for (const file of [PLATFORM, CONNECT]) {
      const secrets = new Set(
        [...read(file).matchAll(/process\.env\.(STRIPE_WEBHOOK_SECRET\w*)/g)].map(m => m[1]),
      );
      expect(
        [...secrets],
        `${file} should read exactly one webhook secret — trying several is how\nan endpoint stops knowing which Stripe account sent it`,
      ).toHaveLength(1);
    }

    const platformSecret = read(PLATFORM).match(/process\.env\.(STRIPE_WEBHOOK_SECRET\w*)/)?.[1];
    const connectSecret = read(CONNECT).match(/process\.env\.(STRIPE_WEBHOOK_SECRET\w*)/)?.[1];
    expect(
      platformSecret,
      "both endpoints read the same secret, so only one of them can ever verify",
    ).not.toBe(connectSecret);
  });

  it("keeps each account's events on its own endpoint", () => {
    // A subscription cannot arrive on a connected account, and a diner's
    // checkout cannot arrive on ours. Handling one on the other's route would
    // be dead code at best and a trust boundary crossed at worst.
    expect(
      read(PLATFORM).includes("checkout.session."),
      "the platform endpoint handles a connected account's checkout",
    ).toBe(false);
    expect(
      read(CONNECT).includes("customer.subscription."),
      "the connect endpoint handles our own account's subscription",
    ).toBe(false);
  });
});

describe("nothing that moves money waits offline", () => {
  /**
   * A status move is safe to hold and replay: marking a ready ticket ready
   * again changes nothing. A payment is not. A settlement replayed on
   * reconnect charges a table twice, a refund replayed gives money away twice,
   * and an approval replayed decides on a board that has moved on.
   *
   * So the queue takes order status and nothing else, and this is what says so
   * — the file is small enough to read, and the next person adding a route to
   * it will find out here rather than from a double charge.
   */
  it("queues no endpoint but the order board's own", () => {
    const src = fs.readFileSync("src/hooks/useRestaurantOrders.ts", "utf8");
    const queued = [...src.matchAll(/writeQueue\(|enqueue\(/g)];
    expect(queued.length, "the queue is no longer wired in").toBeGreaterThan(0);

    // Every path that reaches the queue sits in this one hook, and the only
    // endpoint it sends is /api/orders. Anything else here is a red flag.
    const endpoints = [...src.matchAll(/fetch\(\s*"(\/api\/[^"]+)"/g)].map(m => m[1]);
    const forbidden = endpoints.filter(e => e !== "/api/orders" && e !== "/api/orders/cancel");
    expect(
      forbidden,
      `a money endpoint is being called from the hook that holds work offline —\nqueue order status only:\n${forbidden.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the offline queue out of every settlement path", () => {
    const offenders: string[] = [];
    for (const file of walkAll("src/components").concat(walkAll("src/hooks"))) {
      if (file.endsWith("useRestaurantOrders.ts")) continue;
      const src = fs.readFileSync(file, "utf8");
      if (/\bfrom "@\/lib\/offline-queue"/.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `only the order board may hold work offline; these import the queue:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("cash names the person who took it", () => {
  /**
   * Card money can arrive with nobody standing there — a diner pays online and
   * the webhook records it, so `actor_email` is null and that is correct. Cash
   * cannot: somebody physically took it, and the corte they sign at the end of
   * the night is grouped by exactly that column. A cash payment recorded
   * without an actor is money in a drawer that belongs to no drawer.
   *
   * `pnpm money` checks the rows; this checks the code that writes them, so a
   * new settlement route cannot ship the hole and wait to be noticed in data.
   */
  it("passes actorEmail wherever a payment might not be a card", () => {
    const offenders: string[] = [];

    for (const file of walkAll("src/app/api").filter(f => f.endsWith("route.ts"))) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/recordPayments?\s*\(/g)) {
        const call = callBody(src, m.index + m[0].length);
        // A call that hard-codes "card" is the online path and needs no actor.
        if (/method:\s*"card"(\s+as\s+const)?\s*,/.test(call)) continue;
        if (/actorEmail:/.test(call)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${file}:${line}`);
      }
    }

    expect(
      offenders,
      `a payment that could be cash is recorded with nobody named — pass actorEmail,\nor hard-code method: "card" if it can only ever be an online payment:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("an API error reaches the person in their own language", () => {
  /**
   * `apiError` looks the sentence up in the caller's locale; a sentence written
   * straight into the response does not. 237 errors went through it and 7 did
   * not, so a Spanish owner who typed a coupon code twice was told "That code
   * already exists." and a diner under the card minimum got English mid-payment
   * — and one invite failure answered every English speaker in Spanish.
   */
  /**
   * The same rule, for the errors that are not written as sentences.
   *
   * The check below reads string literals, so six routes handed the client a
   * raw `error.message` from Postgres and it saw nothing: not a literal, so not
   * a sentence. What actually reached the person was a database's own words —
   * the column, the constraint, sometimes the value that broke it — always in
   * English, and describing the schema to whoever asked.
   */
  it("hands nobody a database's own error text", () => {
    const offenders: string[] = [];
    for (const file of walkAll("src/app/api").filter(f => f.endsWith("route.ts"))) {
      read(file).split("\n").forEach((line, i) => {
        if (/NextResponse\.json\(\s*\{[^}]*\b(error|message)\s*:[^}]*\.message\b/.test(line)) {
          offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      `these return a raw database message — log it and answer with an apiError key:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("has no route answering with a sentence of its own", () => {
    // Stripe reads the webhook's errors, not a person, so it keeps English.
    const forMachines = ["src/app/api/webhooks/"];
    const offenders: string[] = [];

    for (const file of walkAll("src/app/api").filter(f => f.endsWith("route.ts"))) {
      if (forMachines.some(m => file.startsWith(m))) continue;
      const code = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
        .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (_m, before: string) => before);

      code.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/"([^"]{15,})"/g)) {
          // A sentence starts with a capital and has a space in it; a key, a
          // header name and a column name have neither.
          if (!/^[A-ZÁÉÍÓÚÑ¿].*\s/.test(m[1])) continue;
          offenders.push(`${file}:${i + 1}  ${m[1].slice(0, 60)}`);
        }
      });
    }

    expect(
      offenders,
      `these answer in one fixed language — hand the key to apiError() instead and\nadd the sentence to both i18n/es.ts and i18n/en.ts:\n${offenders.join("\n")}`,
    ).toEqual([]);
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

describe("secrets cannot reach the browser", () => {
  /**
   * Columns whose value is a credential, and the grants that must never name
   * them.
   *
   * `restaurants` is granted column by column rather than whole, which is what
   * keeps a diner's key from reading a restaurant's private settings — but a
   * column list is edited by hand, and the edit that adds a secret to it looks
   * exactly like the edit that adds a colour. `print_token` is the kitchen
   * printer's ONLY credential: it cannot log in, so whoever holds the URL is
   * the printer. One careless addition to either of these two lines would hand
   * it to every browser that has ever loaded a menu.
   */
  const CREDENTIAL_COLUMNS = ["print_token"];

  it("grants no browser key a column that is a credential", () => {
    const schema = read("supabase/schema.sql");
    const grants = schema
      .split("\n")
      .filter(l => /^grant select \(/.test(l) && /\bto (anon|authenticated)/.test(l));

    expect(grants.length, "no column-scoped grants found — has the schema moved?").toBeGreaterThan(0);

    const leaked: string[] = [];
    for (const line of grants) {
      const columns = line.slice(line.indexOf("(") + 1, line.indexOf(")")).split(",").map(c => c.trim());
      for (const secret of CREDENTIAL_COLUMNS) {
        if (columns.includes(secret)) leaked.push(`${secret} in: ${line.slice(0, 80)}…`);
      }
    }
    expect(
      leaked,
      `a credential column is granted to a browser key — remove it from the grant:\n${leaked.join("\n")}`,
    ).toEqual([]);
  });

  it("never sends a credential column to a client component", () => {
    const offenders: string[] = [];
    for (const file of walkAll("src").filter(f => /\.tsx$/.test(f))) {
      const src = read(file);
      if (!/^\s*["']use client["']/m.test(src.slice(0, 400))) continue;
      for (const secret of CREDENTIAL_COLUMNS) {
        if (src.includes(secret)) offenders.push(`${file} mentions ${secret}`);
      }
    }
    expect(
      offenders,
      `a client component names a credential column — it must be resolved on the server:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  const SECRETS = ["src/lib/supabase/admin.ts", "src/lib/stripe.ts", "src/lib/mail.ts"];

  /** Where an import specifier actually lands, or null if it leaves src/. */
  function resolveSpec(from: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith("@/")) base = path.join("src", spec.slice(2));
    else if (spec.startsWith(".")) base = path.relative(process.cwd(), path.resolve(path.dirname(from), spec));
    else return null;
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      if (fs.existsSync(base + ext)) return base + ext;
    }
    return fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
  }

  it("has no value-import path from a client component to a secret", () => {
    const files = walkAll("src").filter(f => /\.tsx?$/.test(f));
    const edges = new Map<string, string[]>();
    const clients: string[] = [];

    for (const f of files) {
      const src = read(f);
      if (/^\s*["']use client["']/m.test(src.slice(0, 400))) clients.push(f);
      const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
      const out: string[] = [];
      sf.forEachChild(node => {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
        const clause = node.importClause;
        // `import type {…}` and `import {type A, type B}` are both erased.
        if (clause?.isTypeOnly) return;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          const named = clause.namedBindings.elements;
          if (named.length > 0 && named.every(e => e.isTypeOnly) && !clause.name) return;
        }
        const to = resolveSpec(f, node.moduleSpecifier.text);
        if (to) out.push(to);
      });
      edges.set(f, out);
    }

    const leaks: string[] = [];
    for (const start of clients) {
      const seen = new Set([start]);
      const queue: [string, string[]][] = [[start, [start]]];
      while (queue.length) {
        const [cur, trail] = queue.shift()!;
        for (const next of edges.get(cur) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          if (SECRETS.includes(next)) {
            leaks.push(trail.concat(next).join(" → "));
            queue.length = 0;
            break;
          }
          queue.push([next, trail.concat(next)]);
        }
      }
    }

    expect(
      leaks,
      `A client component can reach a secret at runtime. Import the type only, or move the value behind an API route:\n${leaks.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * The rule that rounds money lives in one file.
 *
 * It was written out eleven times — pricing, table-bill, till, corte,
 * promotions, plan and five more. All eleven agreed, so nothing was wrong;
 * but a cent of disagreement between the cart and the bill is the kind of
 * thing nobody notices until a diner does.
 */
/**
 * A webhook Stripe delivers twice must not be money that arrived twice.
 *
 * Stripe re-sends an event whenever it is not certain the first delivery
 * landed. `checkout-settle.ts` says in its own header that every path is
 * written to survive that — "the guards are `.eq("paid", false)` and
 * `.is("paid_at", null)`" — and for a while two of its three paths had
 * neither: the row was marked paid, read back, and recorded again. The ledger,
 * the corte and the day's takings all counted one payment as two. It never bit
 * only because the webhooks had not been registered yet.
 */
describe("a repeated webhook cannot record the same money twice", () => {
  const settle = read("src/lib/checkout-settle.ts");

  it("guards every update that marks an order paid", () => {
    // Each `.update({...paid: true...})` must carry the guard that makes the
    // second delivery match nothing.
    const marks = [...settle.matchAll(/\.update\(\{[^}]*paid:\s*true[\s\S]{0,400}?(?=\n\n|;)/g)];
    expect(marks.length, "found no path that marks an order paid — has the file moved?").toBeGreaterThan(1);

    const unguarded = marks
      .map(m => m[0])
      .filter(block => !/\.eq\(\s*["']paid["']\s*,\s*false\s*\)/.test(block));

    expect(
      unguarded.map(b => b.split("\n")[0]),
      "an update marks an order paid without .eq(\"paid\", false) — a repeated delivery would record the money again",
    ).toEqual([]);
  });

  it("keeps the guard under the guard", () => {
    // The next settle path somebody writes cannot get this wrong, because the
    // database will not hold the duplicate.
    expect(read("supabase/schema.sql")).toMatch(
      /create unique index if not exists payments_one_per_intent[\s\S]*?on payments \(order_id, stripe_payment_intent\)/,
    );
  });

  it("treats a refused duplicate as already recorded, not as a failure", () => {
    expect(read("src/lib/payments.ts")).toMatch(/error\.code !== "23505"/);
  });

  it("adds a tip only on the delivery that settled the bill, and records it", () => {
    // A tip is ADDED to the order's tip and total, so it is the write a
    // repeated delivery does not leave as it was: the whole-table settle added
    // it on every copy of the event. And its payment was written from the
    // totals before the tip, so the ledger said MX$2.50 where Stripe took
    // MX$7.50. The tip's order is one this delivery settled, and the payment
    // for that order carries the tip.
    const start = settle.indexOf("async function settleBill(");
    expect(start, "settleBill not found — has the file moved?").toBeGreaterThan(-1);
    const body = settle.slice(start, settle.indexOf("\n}\n", start));
    expect(body, "the tip's order is not taken from the rows this delivery settled")
      .toMatch(/const tipOrder = [^;]*\bsettled\b/);
    expect(body, "the tip is written to an order other than the one chosen from the settled rows")
      .toMatch(/\.eq\("id", tipOrder\.id\)/);
    expect(body, "the payment for the tip's order does not carry the tip")
      .toMatch(/amount: Number\(o\.total\) \+ tipHere/);
  });
});

/**
 * A row policy is not a column policy.
 *
 * `owner manages restaurant` reads as though it grants an owner the settings
 * they edit. It does not: a policy decides which ROWS a statement may touch and
 * never which columns, so with Supabase's default table-wide grant still in
 * place an owner could write every column of their own row from the browser
 * console — the tier they are on, whether their trial has ended, and which
 * Stripe account their diners' money goes to.
 *
 * The fix is a revoke, and it is a single line that a later `grant` could undo
 * without anybody noticing, so it is asserted here.
 */
describe("a browser key cannot write what it must not set", () => {
  const schema = read("supabase/schema.sql");

  /** Tables whose every write goes through the server, with the secret key. */
  const SERVER_ONLY = ["restaurants", "plan_limits"];

  it("revokes browser writes on the tables that decide what is owed", () => {
    for (const table of SERVER_ONLY) {
      expect(
        schema,
        `${table} must be read-only to a logged-in browser — an owner could otherwise set their own plan`,
      ).toMatch(new RegExp(`revoke insert, update, delete on ${table} from authenticated`));
    }
  });

  it("never grants those writes back", () => {
    for (const table of SERVER_ONLY) {
      const granted = new RegExp(`grant [^;]*\\b(insert|update|delete)\\b[^;]*on [^;]*\\b${table}\\b[^;]*to [^;]*authenticated`, "i");
      expect(granted.test(schema), `${table} is granted back to authenticated somewhere`).toBe(false);
    }
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

describe("money is rounded in one place", () => {
  it("has no second copy of round2", () => {
    const copies = walkAll("src")
      .filter(f => /\.tsx?$/.test(f) && f !== "src/lib/money.ts" && !f.includes("__tests__"))
      .filter(f => /(function|const)\s+round2\b/.test(read(f)));
    expect(
      copies,
      `round2 is defined outside src/lib/money.ts — import it instead:\n${copies.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * Nothing is stamped on a Stripe session that its own webhook never reads.
 *
 * The metadata on a checkout session is the only thing that survives the trip
 * to Stripe and back: whatever the route writes there is all the webhook will
 * ever know about what the diner was charged for. A key written and never read
 * is a fact the app threw away — and one of them was a gratuity. A share of a
 * divided bill carried `settle_tip`, Stripe charged it, the restaurant
 * received it, and the ledger recorded the food alone. It stayed that way
 * because the key WAS read, just by the other settle path.
 *
 * So each route is checked against the one function that settles what it sent,
 * and the source is read rather than the running app, because a webhook is not
 * something a test can ring.
 */
describe("every fact sent to Stripe is read back", () => {
  const PAIRS = [
    ["src/app/api/split/pay/route.ts", "settleSplitShare"],
    ["src/app/api/bill/pay/route.ts", "settleBill"],
    ["src/app/api/checkout/route.ts", "settleOrder"],
  ] as const;

  /** Keys of every `metadata: { ... }` object in a file, nesting and all. */
  function keysWritten(file: string): string[] {
    const source = read(file);
    const keys = new Set<string>();
    for (const at of [...source.matchAll(/metadata:\s*\{/g)]) {
      let depth = 1;
      let i = (at.index ?? 0) + at[0].length;
      const from = i;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
        i++;
      }
      for (const pair of source.slice(from, i).matchAll(/(?:^|[{,])\s*([a-z_]+):/g)) {
        keys.add(pair[1]);
      }
    }
    return [...keys];
  }

  /** One function's body, by name, up to the line that closes it. */
  function bodyOf(source: string, name: string): string {
    const at = source.indexOf(`function ${name}(`);
    expect(at, `checkout-settle no longer has ${name}`).toBeGreaterThan(-1);
    const end = source.indexOf("\n}\n", at);
    return source.slice(at, end === -1 ? source.length : end);
  }

  it("is read by the function that settles it", () => {
    const settle = read("src/lib/checkout-settle.ts");
    const orphans: string[] = [];
    for (const [route, fn] of PAIRS) {
      const body = bodyOf(settle, fn);
      for (const key of keysWritten(route)) {
        if (!body.includes(key)) orphans.push(`${route} writes ${key}, ${fn} never reads it`);
      }
    }
    expect(
      orphans,
      `a checkout session carries something its own webhook throws away:\n${orphans.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * Money that arrives is written down.
 *
 * `orders.paid` and the `payments` ledger are two records of one fact, which is
 * the shape of every bug this app has had. `pnpm money` catches them drifting
 * in the data; this catches the cause — a route that marks an order paid and
 * forgets to say who paid what.
 *
 * Looking for a CALL rather than the name, because an import line alone would
 * satisfy a substring check long after somebody deleted the call beneath it.
 */
describe("every route that settles an order records the payment", () => {
  const SETTLES = [
    ["src/app/api/table-payment/route.ts", "the till stopped recording what it took"],
    // Every centavo here is recorded as it is collected; the pass that marks
    // the orders paid at the end deliberately records nothing, because the
    // money is already in the ledger under its own collection.
    ["src/app/api/table-payment/part/route.ts", "a bill settled in parts records none of it"],
    ["src/lib/checkout-settle.ts", "a card payment is no longer written to the ledger"],
    ["src/app/api/pos/order/route.ts", "a counter sale is no longer written to the ledger"],
  ] as const;

  it("calls recordPayment wherever it sets paid", () => {
    for (const [file, complaint] of SETTLES) {
      const lines = read(file).split("\n").filter(l => !l.trimStart().startsWith("import"));
      const marksPaid = lines.filter(l => /paid:\s*true/.test(l)).length;
      // `recordPayment`, or the SQL that does the same job under a lock. The
      // calculator moved to `collect_on_sitting` so that reading the balance,
      // capping against it and inserting happen atomically — two waiters on
      // one table had been taking MX$400 for a MX$200 bill. It is still a
      // route that settles orders and still has to record the money; this
      // invariant just had to learn the second spelling.
      const records = lines.filter(
        l => /\brecordPayments?\s*\(/.test(l) || /collect_on_sitting/.test(l),
      ).length;
      expect(marksPaid, `${file}: nothing marks an order paid any more`).toBeGreaterThan(0);
      expect(records, `${file}: ${complaint}`).toBeGreaterThan(0);
    }
  });

  it("has no other route marking an order paid on the quiet", () => {
    const known = new Set<string>(SETTLES.map(([f]) => f));
    const rogue = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts") && !known.has(f))
      .filter(f => /paid:\s*true/.test(read(f)));
    expect(
      rogue,
      `A route settles orders without recording the money. Add recordPayment, and add it to the list above:\n${rogue.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * Every route reads its body through `jsonBody`.
 *
 * `await req.json()` throws on anything that is not JSON and hands back a
 * perfectly good `null` for the body `null`, which then throws again the moment
 * somebody destructures it. Twenty-seven routes answered 500 to a truncated
 * upload, an empty POST or the four characters `null` — several of them
 * reachable with no login at all: calling a waiter, rating a dish, checking a
 * coupon, signing up.
 *
 * `.catch(() => ({}))` was the older attempt and covers only half of it: the
 * parse error, not the body that parses into something with no fields.
 */
describe("no route parses a body by hand", () => {
  it("reads every request body through jsonBody", () => {
    const raw = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts"))
      .filter(f => /await req\.json\(\)/.test(read(f)));
    expect(
      raw,
      `These parse a body directly, so malformed input reaches them as an exception.\n` +
        `Use \`jsonBody\` and answer 400:\n${raw.join("\n")}`,
    ).toEqual([]);
  });
});

describe("a refusal always carries a sentence", () => {
  it("never answers a bare rejection object", () => {
    // `/api/table-order` returned `{ rejection }` — a shape with no `error`
    // field. The waiter's screen falls back to "network error" when there is
    // no message, so a sold-out dish read as a dead connection: the waiter
    // retried instead of telling the table. Every refusal a screen shows has
    // to arrive as words.
    const bare = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts"))
      .filter(f => /json\(\s*\{\s*rejection\b/.test(read(f)));
    expect(
      bare,
      `These answer with a rejection the client cannot render, so it shows a\n` +
        `network error instead. Translate it with \`rejectionMessage\`:\n${bare.join("\n")}`,
    ).toEqual([]);
  });

  it("wires every CartRejection kind to a message", () => {
    // The mapping is exhaustive by type, but a new kind added with a `return`
    // in the wrong place would silently fall through to the extras sentence.
    const kinds = [...read("src/lib/verify-cart.ts").matchAll(/\{ kind: "(\w+)"/g)].map(m => m[1]);
    const wiring = read("src/lib/cart-rejection.ts");
    const unwired = [...new Set(kinds)].filter(k => !wiring.includes(`"${k}"`));
    expect(
      unwired,
      `These rejection kinds have no branch in rejectionMessage:\n${unwired.join("\n")}`,
    ).toEqual([]);
  });
});

describe("Stripe's limits are respected where we build its payloads", () => {
  it("never joins an unbounded list into one metadata value", () => {
    // A metadata value stops at 500 characters, which is fourteen order ids.
    // `settle_order_ids: ids.join(",")` fitted a table of thirteen and made
    // the fourteenth unable to pay by card at all.
    const offenders = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts"))
      .filter(f => /settle_order_ids:\s*[^\n]*\.join\(/.test(read(f)));
    expect(
      offenders,
      `These build a metadata value by joining a list, which Stripe refuses\n` +
        `past 500 characters. Use \`packOrderIds\`:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("caps the card cart below Stripe's line-item ceiling", () => {
    // Checkout emits one line item per cart line plus the service charge and
    // the tip, and Stripe Checkout takes 100 of them.
    const checkout = read("src/app/api/checkout/route.ts");
    expect(
      checkout.includes("MAX_CARD_CART_LINES"),
      "checkout must cap the cart at the card path's own limit, not the general one",
    ).toBe(true);
  });

  it("trims the Stripe product names that carry a value from the database", () => {
    // Dish names and restaurant names are written from the browser under RLS
    // with no column cap, and Stripe refuses a product name over 250. The
    // fixed labels beside them — "Tip", "Service charge (10%)" — are bounded
    // by the code that writes them and are deliberately not the subject here.
// Two ways this regex lied before it worked. `[^}\n]` and not `[^}]`,
    // because a class that allows newlines walks off the end of the line and
    // finds a `${}` several lines below. And the "not already wrapped" test
    // covers the whole rest of the line: put after `\\s*`, it is checked at a
    // position `\\s*` can reach by matching nothing, so it passed on the space
    // and the call it was meant to exclude sailed through. Both versions
    // accused two call sites that were already correct.
    const risky =
      /\bname:(?![^\n]*stripeProductName)[^\n]*\$\{[^}\n]*\b(?:restaurant\.name|v\.name)\b/;
    const offenders = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts"))
      .filter(f => risky.test(read(f)));
    expect(
      offenders,
      `These interpolate a name out of the database into a Stripe product name\n` +
        `without trimming it to 250 characters:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("no screen offers a refund the till cannot give", () => {
  it("words the offer from the plan the cancel itself will follow", () => {
    // The cancel dialog said "Cancel & refund MX$100" for any paid order. On a
    // cash sale, a card charged on the restaurant's own terminal, or an order
    // of a table's bill paid online in one go, the route could not refund it
    // and answered "payment is still settling — try again", which would never
    // once become true. The screen promised and the server refused, which is
    // this app's oldest bug shape.
    //
    // Two places guessing from `pay_method` agreed only about cash. Now there
    // is one place: the route's GET and POST both read the plan through
    // `readCancel`, and the board words its offer from what the GET answers.
    const board = read("src/components/dashboard/OrdersBoard.tsx");
    const cancel = board.slice(board.indexOf("async function handleCancel"));
    // Code only: the comment explaining why it must not read pay_method names it.
    const code = (src: string) => src.replace(/\/\/.*$/gm, "");
    const handler = code(cancel.slice(0, cancel.indexOf("\n  }\n") + 4));
    expect(handler, "the dialog no longer asks the server what the cancel will do").toMatch(/cancelPlanFor\(/);
    expect(handler, "the dialog no longer words its offer from that answer").toMatch(/cancelWording\(/);
    expect(handler, "the dialog guesses from pay_method again").not.toMatch(/pay_method/);

    const route = read("src/app/api/orders/cancel/route.ts");
    const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
    const post = code(route.slice(route.indexOf("export async function POST")));
    expect(get, "GET does not read the plan the POST follows").toMatch(/readCancel\(/);
    expect(post, "POST does not follow the plan the GET described").toMatch(/readCancel\(/);
    expect(post, "POST decides for itself how the money came in").not.toMatch(/pay_method/);
  });
});

describe("one order, one code", () => {
  it("builds the ORD- code in exactly one place", () => {
    // There were two. `orderCode` in types.ts strips the dashes before taking
    // four characters; `shortCode` in open-bills.ts did not. For a uuid they
    // agree — 200,000 random ones, no difference — so nothing was ever wrong
    // on screen. But a cashier searching for a bill types the code the
    // customer reads off their phone, and two functions that must agree are
    // one edit away from not.
    const builders = walkAll("src/lib")
      .concat(walkAll("src/components"))
      .filter(f => /\.tsx?$/.test(f) && !f.includes("__tests__"))
      .filter(f => /["'`]ORD-|ORD-\$\{/.test(read(f)))
      .filter(f => !f.endsWith("src/lib/types.ts"))
      // order-code.ts reads a code back into the id range it covers — the
      // inverse, not a second copy. That the two agree is asserted directly in
      // order-code.spec.ts rather than by counting files.
      .filter(f => !f.endsWith("src/lib/order-code.ts"));
    expect(
      builders,
      `These build an order code of their own. There is one in \`types.ts\`:\n${builders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("every key a person is shown has words behind it", () => {
  it("resolves every i18n key written as a literal", () => {
    // `translate` takes `key: string`, so TypeScript never sees these. A miss
    // returns the key itself — deliberately, so a gap shows rather than
    // crashing — which means a typo reaches a customer as the text
    // "apiErr.tooManyLines" and nothing in the build says a word.
    //
    // The nested SHAPE of the two dictionaries is type-checked (es.ts is typed
    // as Messages, so a missing or extra key is a compile error). What is not
    // checked is whether the string somebody passes matches any of it.
    const resolve = (key: string): unknown =>
      key.split(".").reduce<unknown>(
        (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
        en as unknown,
      );

    const missing: string[] = [];
    const files = walkAll("src").filter(
      f => /\.tsx?$/.test(f) && !f.includes("__tests__") && !f.includes("/i18n/"),
    );
    for (const file of files) {
      const src = read(file);
      const patterns = [
        /\bt\(\s*["']([a-zA-Z][\w.]*\.[\w.]+)["']/g,
        /translate\(\s*\w+\s*,\s*["']([a-zA-Z][\w.]*\.[\w.]+)["']/g,
        /apiError\(\s*["']([a-zA-Z][\w.]*\.[\w.]+)["']/g,
        // Keys that travel as data rather than as an argument — the timezone
        // list hands one to the settings dropdown for every zone it offers.
        /labelKey:\s*["']([a-zA-Z][\w.]*\.[\w.]+)["']/g,
      ];
      for (const pattern of patterns) {
        for (const m of src.matchAll(pattern)) {
          if (typeof resolve(m[1]) !== "string") missing.push(`${file}: ${m[1]}`);
        }
      }
    }
    expect(
      missing,
      `These keys have no words behind them, so a person reads the key:\n${missing.join("\n")}`,
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

describe("a sale is handed back once", () => {
  it("cancels conditionally, so of two racing cancels only one writes a handback", () => {
    // The handback line is money: the corte takes it out of the drawer of
    // whoever took the cash. Two cancels racing on an unconditional write both
    // succeed, both log, and the sale leaves the drawer twice — while the
    // stock it held goes back on the shelf twice.
    const src = read("src/app/api/orders/cancel/route.ts");
    const at = src.indexOf('.update({ status: "cancelled"');
    expect(at, "the cancel route no longer sets the status where this looks").toBeGreaterThan(-1);
    const write = src.slice(at, src.indexOf(";", at));
    expect(write, "the cancel write is not conditional on the status it read").toMatch(/\.in\("status"|\.eq\("status"/);
    expect(write, "the cancel write does not say whether it moved a row").toMatch(/\.select\(/);

    const refused = src.slice(at).search(/if \(!\w+\?\.length\) return/);
    const handback = src.indexOf('action: "refunded"');
    expect(refused, "nothing refuses the cancel that lost the race").toBeGreaterThan(-1);
    expect(handback, "the handback is written before the race is settled").toBeGreaterThan(at + refused);
  });
});

describe("a gate that cannot sign in says so", () => {
  it("reads the error of every sign-in a script makes", () => {
    // A sign-in that fails and is not read leaves the script signed out, and
    // a signed-out check passes for the wrong reason: the login screen has
    // nothing to overlap, and an anonymous key cannot read the columns a staff
    // account is being tested against. A network blip turned nine of a
    // manager's screens into oks nobody had seen.
    const offenders: string[] = [];
    for (const file of fs.readdirSync("scripts").filter(f => f.endsWith(".mjs"))) {
      const src = read(`scripts/${file}`);
      for (const m of src.matchAll(/signInWithPassword\(/g)) {
        const start = src.lastIndexOf("\n", m.index!) + 1;
        const statement = src.slice(start, m.index!);
        const after = src.slice(m.index!, m.index! + 250);
        const line = src.slice(0, m.index!).split("\n").length;
        if (!/=\s*await\s+[\w.]+$/.test(statement)) offenders.push(`scripts/${file}:${line} — result thrown away`);
        else if (!/err/i.test(statement + after)) offenders.push(`scripts/${file}:${line} — error never read`);
      }
    }
    expect(offenders, `These sign-ins can fail silently:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("the board loads what the badge counts", () => {
  it("seeds the live board by status, not by the newest rows of any status", () => {
    // The newest 100 orders of every status, filtered to the live ones after
    // they arrived: after a busy stretch, an order the kitchen had not started
    // was not loaded at all — while the Pedidos badge, counting by status,
    // still counted it. The board and the badge have to agree on what "live"
    // means, and only a status can say it.
    const page = read("src/app/dashboard/orders/page.tsx");
    const at = page.indexOf('.from("orders")');
    const query = page.slice(at, page.indexOf("),", at));
    expect(query, "the board is no longer seeded by status").toMatch(/\.in\("status", LIVE_FLOW\)/);
    expect(query, "a row limit decides which live orders the kitchen sees").not.toMatch(/\.limit\(/);
  });
});

describe("a sweep that clicks everything changes nothing", () => {
  it("holds back every write the dialogs sweep sends, and checks nothing moved", () => {
    // One run completed every live order on the demo board, reordered menus,
    // duplicated dishes and approved a write-off — and the next `pnpm layout`
    // found no order to open and skipped the order dialog without failing.
    const sweep = read("scripts/dialog-check.mjs");
    expect(sweep, "the dialogs sweep no longer holds back its writes").toMatch(/await holdWrites\(ctx, held\)/);
    expect(sweep, "the dialogs sweep no longer compares the data before and after").toMatch(/changedParts\(before,/);
  });

  it("seeds every account on the terms the app enforces", () => {
    // A copy "kept in step by hand" fell a month behind: every seeded account
    // opened on the terms modal, and a sweep that may not write measured every
    // owner screen from underneath it.
    const copies = fs.readdirSync("scripts")
      .filter(f => f.endsWith(".mjs") && /TERMS_VERSION\s*=\s*["']\d/.test(read(`scripts/${f}`)));
    expect(copies, "a script keeps its own terms version").toEqual([]);
    expect(read("scripts/mock-data.mjs"), "the demo restaurant is seeded with no terms accepted")
      .toMatch(/terms_version, terms_accepted_at, terms_accepted_email/);
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
    expect(read("src/lib/ordering-data.ts"), "the diner's offer decides by itself").toMatch(/await loyaltyOn\(/);
    expect(read("src/app/api/loyalty/card/route.ts"), "the card route no longer asks loyaltyOn").toMatch(/await loyaltyOn\(/);
    for (const screen of ["src/components/dashboard/BillsPanel.tsx", "src/components/dashboard/pos/PosScreen.tsx"]) {
      expect(read(screen), `${screen} shows the scanner without being told to`).toMatch(/\{loyalty &&[^}]*<StampCard/);
    }
  });
});

describe("a date reads in the reader's language, not the machine's", () => {
  it("never formats a date with the server's default locale", () => {
    // `new Intl.DateTimeFormat([])` and a bare `toLocaleDateString()` answer in
    // whatever language the machine was set to — English on the host — so a
    // Spanish owner's analytics said "25 Tue". Prices were fixed the same way.
    const offenders: string[] = [];
    for (const file of walkAll("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))) {
      const src = read(file);
      if (/Intl\.DateTimeFormat\(\s*\[\s*\]/.test(src) || /toLocale(Date)?String\(\s*\)/.test(src)) offenders.push(file);
    }
    expect(offenders, `dates in the machine's language:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("a date on screen is in the app's language", () => {
  it("never formats a date or a time in the browser's own language", () => {
    // `toLocaleString([])` answers in whatever language the browser is set to,
    // so a Spanish owner on an English phone read "Sep 23" beside Spanish
    // words — and the server, rendering the same component, could write it in
    // a third. `dateLocale(locale)` is the app's language, which both read.
    const offenders: string[] = [];
    for (const file of walkAll("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))) {
      // Code only: the comment that explains the rule quotes what it forbids.
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (/toLocale(Time|Date)?String\(\s*(\[\]|undefined)/.test(code)) offenders.push(file);
    }
    expect(offenders, `dates in the browser's language:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("the sweeps open the narrowest phone people carry", () => {
  it("measures every screen and every dialog at 360px", () => {
    // 360 is the most common Android width, and neither sweep opened it: the
    // menu editor's product row already spilled past its box there, and
    // Analytics broke a dish name in half, while 390 read clean. Read from the
    // code, so a comment naming 360 cannot pass for the width.
    const widths = (file: string, list: RegExp, each: RegExp): number[] => {
      const code = read(`scripts/${file}`).replace(/\/\/.*$/gm, "");
      const body = code.match(list)?.[1] ?? "";
      return [...body.matchAll(each)].map(m => Number(m[1]));
    };
    const layout = widths("layout-check.mjs", /const SIZES = \[([\s\S]*?)\];/, /width:\s*(\d+)/g);
    const dialogs = widths("dialog-check.mjs", /const WIDTHS = \[([^\]]*)\]/, /(\d+)/g);
    expect(layout.length, "layout-check.mjs: SIZES not found — the scan broke").toBeGreaterThan(2);
    expect(dialogs.length, "dialog-check.mjs: WIDTHS not found — the scan broke").toBeGreaterThan(1);
    expect(Math.min(...layout), "pnpm layout never opens a 360px phone").toBe(360);
    expect(Math.min(...dialogs), "pnpm dialogs never opens a 360px phone").toBe(360);
  });
});

describe("a failed read is never an answer", () => {
  it("never stands a made-up answer in for a response that failed", () => {
    // An empty bill is a settled bill, a closed sitting is a forgotten one, and
    // no badges means nothing is waiting. `r.ok ? r.json() : { orders: [] }`
    // told a diner who owed that they had paid, and asked if they wanted the
    // receipt; the waiter's copy said "this table owes nothing"; `{ open:
    // false }` made a phone forget the table it still owed at; `{ badges: {} }`
    // told a waiter nobody was calling. A failed read keeps what was known,
    // or says it failed.
    let reads = 0;
    const offenders: string[] = [];
    for (const file of walkAll("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__") && !f.includes("/app/api/"))) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      reads += (code.match(/\.ok\b/g) ?? []).length;
      const madeUp = /\.ok\s*\?\s*(await\s+)?\w+\.json\(\)\s*:\s*[{[]/.test(code);
      const emptied = /catch\(\s*\(\)\s*=>\s*set\w+\(\s*(\[\s*\]|\{\s*\}|null|false|0)\s*\)/.test(code);
      if (madeUp || emptied) offenders.push(file);
    }
    expect(reads, "no response was ever checked — the scan broke").toBeGreaterThan(10);
    expect(offenders, `a failed read shown as an answer:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("a guard on money fails closed", () => {
  // `staffOpenedBill` refuses a card while a waiter collects the same food,
  // `splitInProgress` refuses the whole bill while its shares are collected.
  // Both read the database and dropped the error, so a failed read answered
  // "no" — the one answer that lets the charge through.
  const GUARDS: [string, string][] = [
    ["src/lib/table-session.ts", "staffOpenedBill"],
    ["src/lib/split-service.ts", "splitInProgress"],
  ];

  it("checks the error of every read a guard makes", () => {
    const offenders: string[] = [];
    for (const [file, name] of GUARDS) {
      const src = read(file);
      const start = src.indexOf(`export async function ${name}(`);
      expect(start, `${name} not found in ${file} — the scan broke`).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("\n}\n", start));
      const queries = (body.match(/await db\b/g) ?? []).length;
      const checked = (body.match(/if \(\w*[eE]rror\) throw/g) ?? []).length;
      if (queries === 0 || checked < queries) offenders.push(`${name}: ${queries} read(s), ${checked} checked`);
    }
    expect(offenders, `a money guard that can answer "no" by failing:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("refuses at every call site where the guard cannot answer", () => {
    // A throw outside the route's try is a bare 500 with no sentence; each
    // caller turns it into the same refusal the orders read gives.
    const offenders: string[] = [];
    for (const file of walkAll("src/app/api").filter(f => f.endsWith("route.ts"))) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const [, name] of GUARDS) {
        if (new RegExp(`if \\(await ${name}\\(`).test(code)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders, `a guard whose failure becomes a bare 500:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("a polled route is sized for the room that polls it", () => {
  // Every public limit is keyed by address, and a restaurant's Wi-Fi is one
  // address for the whole room. The tracker's route allowed 120 a minute —
  // "far above what a real diner's phone asks for" — and thirty diners on the
  // menu, each following one order, used all of it. The poll and the limit
  // were two numbers in two files; now both come from poll.ts.
  const POLLED = {
    "/api/order-status": "src/app/api/order-status/route.ts",
    "/api/split?": "src/app/api/split/route.ts",
    "/api/bill?": "src/app/api/bill/route.ts",
  } as const;
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("polls these routes only at an interval from poll.ts", () => {
    const pollers: string[] = [];
    const offenders: string[] = [];
    for (const file of walkAll("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__") && !f.includes("/app/api/"))) {
      const src = code(file);
      if (!Object.keys(POLLED).some(route => src.includes(route)) || !src.includes("setInterval(")) continue;
      pollers.push(file);
      const fromPoll = /from "@\/lib\/poll"/.test(src);
      const literal = /setInterval\([^;]*?,\s*[\d_]+\s*\)/.test(src);
      if (!fromPoll || literal) offenders.push(file);
    }
    expect(pollers.length, "no poller of these routes was found — the scan broke").toBeGreaterThan(3);
    expect(offenders, `a poll whose rate its route does not know:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("sizes each of those routes' limits from the same poll", () => {
    const offenders = Object.values(POLLED).filter(f => {
      const hits = [...code(f).matchAll(/isRateLimited\(`(order-status|split|bill):\$\{clientIp\(req\)\}`,\s*([^,]+),/g)];
      return hits.length === 0 || hits.some(m => !m[2].includes("forTheRoom("));
    });
    expect(offenders, `a limit sized for one phone:\n${offenders.join("\n")}`).toEqual([]);
  });
});
