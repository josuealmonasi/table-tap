import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

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
    const clearing = sources.filter(f => {
      const body = read(f);
      return /paid:\s*true|written_off:\s*true/.test(body) && /\.update\(/.test(body);
    });
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
        !/acting(Staff|FrontOfHouse|Manager|Owner)|isRateLimited|getPlatformAdmin|stripe-signature/.test(
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
