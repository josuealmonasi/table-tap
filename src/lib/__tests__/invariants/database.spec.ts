import { describe, expect, it } from "vitest";
import { walkAll, schema, sources, read } from "./helpers";

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

describe("the RLS gate asks about every table", () => {
  it("names every table in the public-key sweep, unless a diner reads it on purpose", () => {
    // The cash drawer's shifts and withdrawals shipped in no list of the RLS
    // gate. Their grants were right; nothing would have said so if they had
    // not, because the sweep asks only about the tables it names and nothing
    // made a new table be named. Six more private tables were found missing
    // the day this was written — all refused, none asked.
    const tables = [...schema.matchAll(/create table if not exists ([a-z_]+)/g)].map(m => m[1]);
    const src = read("scripts/rls-check.mjs");
    const start = src.indexOf(`console.log("The key on every diner's phone");`);
    expect(start, "the public-key sweep moved or was renamed").toBeGreaterThan(0);
    const listed = new Set([...src.slice(start, src.indexOf("]) {", start)).matchAll(/"([a-z_]+)"/g)].map(m => m[1]));
    // The menu hangs off a QR: a diner with no login reads these, and
    // `restaurants` is checked column by column right below the list.
    const PUBLIC = ["restaurants", "menus", "categories", "menu_items", "item_addons", "promotions", "promotion_items", "dietary_tags"];
    const unasked = tables.filter(t => !listed.has(t) && !PUBLIC.includes(t));
    expect(unasked, `tables the RLS gate never asks the public key about — add them to its first list:\n${unasked.join("\n")}`).toEqual([]);
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

  it("returns an order's stock in the transaction that removes it", () => {
    const sql = read("supabase/schema.sql");
    expect(sql).toMatch(/create trigger return_order_stock after update or delete on orders/);
    expect(sql).toContain("perform release_stock_reservation(old.restaurant_id, old.stock_reservation_id)");
    expect(sql).toContain("perform release_stock_reservation(new.restaurant_id, new.stock_reservation_id)");
    expect(read("src/lib/checkout-abandon.ts")).toContain('rpc("abandon_checkout"');
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

describe("every database function names its search path", () => {
  it("sets search_path on each function in schema.sql", () => {
    // A function without one resolves `dietary_tags` against whatever path
    // the caller set, so a caller who puts their own schema first decides
    // which table it writes. Supabase's advisor flagged the two seed functions
    // after every other function already had it; this keeps the list at none.
    const sql = read("supabase/schema.sql");
    const fns = [...sql.matchAll(/create or replace function (public\.[a-z_]+)\([^)]*\)([\s\S]*?)\$\$/g)];
    expect(fns.length, "no function found in schema.sql — the scan broke").toBeGreaterThan(20);
    const open = fns.filter(([, , head]) => !/set search_path/.test(head)).map(([, name]) => name);
    expect(open, "a function whose search path the caller decides").toEqual([]);
  });
});

describe("a policy asks who is signed in once, not once a row", () => {
  it("wraps auth.uid() in a select inside every policy", () => {
    // A bare auth.uid() in a policy is evaluated for every row the query
    // touches; (select auth.uid()) is evaluated once and means the same. The
    // staff-membership policy runs on every dashboard request, and Supabase's
    // advisor flagged it and the own-profile policy. Functions may call it
    // bare — they run once per call.
    const sql = read("supabase/schema.sql");
    const policies = [...sql.matchAll(/create policy "([^"]+)"([\s\S]*?);/g)];
    expect(policies.length, "no policy found in schema.sql — the scan broke").toBeGreaterThan(10);
    const bare = policies
      .filter(([, , body]) => /auth\.uid\(\)/.test(body.replace(/\(select auth\.uid\(\)\)/g, "")))
      .map(([, name]) => name);
    expect(bare, "a policy that asks auth.uid() once per row").toEqual([]);
  });
});

describe("approval requests are written only by guarded routes", () => {
  it("has no browser mutation of either request table", () => {
    const offenders = walkAll("src/components").concat(walkAll("src/hooks")).filter(file =>
      /\.from\("(?:discount_requests|write_off_requests)"\)\s*\.(?:insert|update|delete)\(/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("staff write only the columns their screens write", () => {
  it("lets the browser change a service request's status and nothing else", () => {
    // The board marks a call answered, and that is all. With the whole row
    // writable, a member could point their own request at another restaurant's
    // table, and that table's calls were answered "already asked".
    const writes = walkAll("src/components").concat(walkAll("src/hooks"))
      .flatMap(f => read(f).match(/\.from\("service_requests"\)\.update\(\{[^}]*\}/g) ?? []);
    expect(writes.length, "the scan found no browser update of service_requests").toBeGreaterThanOrEqual(1);
    expect(writes.filter(w => !/^\.from\("service_requests"\)\.update\(\{ status: "done" \}$/.test(w))).toEqual([]);
    const revoke = schema.lastIndexOf("revoke update on service_requests from authenticated;");
    const grant = schema.lastIndexOf("grant update (status) on service_requests to authenticated;");
    expect(revoke, "service_requests is still writable whole by staff").toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it("matches a duplicate call within its own restaurant", () => {
    const route = read("src/app/api/service-requests/route.ts");
    const lookup = route.slice(route.indexOf('.from("service_requests")'), route.indexOf(".limit(1)"));
    expect(lookup).toContain('.eq("restaurant_id", restaurantId)');
  });
});

describe("a database call names the arguments its function takes", () => {
  // PostgREST finds a function by its argument NAMES. A call with a stale set
  // finds nothing, and a route that does not read that error carries on as if
  // it had worked: proposing a split after the function gained its restaurant,
  // table and sitting arguments left the proposer without a seat, silently.
  // So every `.rpc()` with a literal argument object must fit one overload in
  // schema.sql: no unknown names, and every argument without a default given.
  const signatures = new Map<string, { name: string; optional: boolean }[][]>();
  for (const m of schema.matchAll(/create or replace function public\.(\w+)\s*\(([\s\S]*?)\)\s*returns/gi)) {
    const args = m[2].replace(/--[^\n]*/g, "").split(",").map(a => a.trim()).filter(Boolean)
      .map(a => ({ name: a.split(/\s+/)[0], optional: /\bdefault\b|=/.test(a) }));
    signatures.set(m[1], [...(signatures.get(m[1]) ?? []), args]);
  }

  /** The names in a call's argument object, or null when it spreads another. */
  function argumentNames(src: string, from: number): string[] | null {
    let depth = 1;
    let body = "";
    for (let i = from; i < src.length && depth > 0; i++) {
      if (src[i] === "{") depth++;
      if (src[i] === "}") depth--;
      if (depth > 0) body += src[i];
    }
    body = body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    let nested = 0;
    let top = "";
    for (const c of body) {
      if ("{[(".includes(c)) nested++;
      if ("}])".includes(c)) nested--;
      top += nested === 0 ? c : " ";
    }
    const names = top.split(",").map(s => s.trim()).filter(Boolean)
      .map(s => (s.includes(":") ? s.slice(0, s.indexOf(":")).trim() : s));
    return names.some(n => n.startsWith("...")) ? null : names;
  }

  it("fits every rpc call to a function in schema.sql", () => {
    const misfits: string[] = [];
    let checked = 0;
    for (const file of sources) {
      const src = read(file);
      for (const m of src.matchAll(/\.rpc\(\s*"(\w+)"\s*(,\s*\{)?/g)) {
        const overloads = signatures.get(m[1]);
        if (!overloads) { misfits.push(`${file}: ${m[1]} is not in schema.sql`); continue; }
        const names = m[2] ? argumentNames(src, m.index! + m[0].length) : [];
        if (names === null) continue;
        checked++;
        const fits = overloads.some(args =>
          names.every(n => args.some(a => a.name === n)) && args.every(a => a.optional || names.includes(a.name)));
        if (!fits) misfits.push(`${file}: ${m[1]}(${names.join(", ")})`);
      }
    }
    expect(checked, "the scan found too few database calls").toBeGreaterThanOrEqual(50);
    expect(misfits).toEqual([]);
  });
});
