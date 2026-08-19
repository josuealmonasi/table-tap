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
    // El log entra como children desde la página, no dentro del panel.
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

  it("keeps the activity log behind a manager check", () => {
    // Bills is open to waiters. The log is not.
    const page = read("src/app/dashboard/bills/page.tsx");
    expect(page).toMatch(/MANAGES\(membership\.role\)/);
  });
});
