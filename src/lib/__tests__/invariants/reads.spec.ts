import { describe, expect, it } from "vitest";
import { walk, walkAll, read } from "./helpers";

describe("a read that grows with time reads every row", () => {
  it("pages every time-windowed read of a table that keeps growing", () => {
    // PostgREST stops each read at its row cap — 1000 on Supabase — and says
    // nothing. A period read in one request is its first thousand rows:
    // analytics showed "1000 Pedidos" and MX$1,000.00 for a day of 1100, the
    // shift's expected cash and the accounts' balances summed part of their
    // rows, and `.limit(10000)` on the visit card's numbers changed nothing,
    // because the cap wins. A window over a growing table pages
    // (`everyRow`), or says how few it wants (a limit at or under the cap),
    // or only counts.
    const GROWING = ["orders", "payments", "user_logs", "loyalty_cards", "loyalty_visits", "loyalty_redemptions",
      "waste_entries", "ingredient_purchases", "ingredient_counts", "ingredient_prices", "cash_movements",
      "coupon_redemptions", "dish_ratings", "print_jobs", "notifications", "terminal_deposits"];
    const files = walk("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"));
    const offenders: string[] = [];
    let windows = 0;
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/\.from\("([a-z_]+)"\)/g)) {
        if (!GROWING.includes(m[1])) continue;
        const end = src.indexOf(";", m.index);
        const chain = src.slice(m.index, end === -1 ? undefined : end);
        if (!/\.(gte|gt|lt|lte)\("(created_at|offline_at|opened_at|sales_day)"/.test(chain)) continue;
        windows++;
        // Paged when the nearest `everyRow` before it wraps this read and no
        // other — a row type's own semicolons make "the statement" useless.
        const before = src.slice(Math.max(0, m.index - 400), m.index);
        const call = before.lastIndexOf("everyRow");
        const limit = /\.limit\((\d[\d_]*)\)/.exec(chain);
        const paged = call !== -1 && !before.slice(call).includes(".from(") && /\.range\(/.test(chain);
        // One table's bill, one sitting, one order or one account is a
        // handful of rows whatever the window says.
        const oneThing = /\.eq\("(id|table_id|session_id|order_id|account_id|card_id|shift_id)",/.test(chain);
        const bounded = oneThing || /head:\s*true/.test(chain) || /\.(single|maybeSingle)\(\)/.test(chain)
          || (limit !== null && Number(limit[1].replace(/_/g, "")) <= 1000);
        if (!paged && !bounded) offenders.push(`${f}: .from("${m[1]}") over a time window`);
      }
    }
    expect(windows, "the scan found no time-windowed read").toBeGreaterThan(10);
    expect(offenders, `reads that stop at the row cap without saying so — page them with everyRow:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("pages every read of the extras each dish offers", () => {
    // `item_addons` grows with the menu, not the clock: dishes times extras,
    // and a coffee shop with a hundred drinks and ten milks, syrups and shots
    // is past the cap. The menu editor read it in one request and swallowed
    // any error, and saving a dish's extras replaces its whole set with what
    // the editor holds — so a set read short is saved short, and the rest are
    // deleted. Its ids rode in one URL too, which the server refuses past a
    // few hundred dishes. A read pages (`everyRow`, `everyRowIn`) or is one dish's.
    const files = walk("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"));
    const offenders: string[] = [];
    let reads = 0;
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/\.from\("item_addons"\)/g)) {
        const end = src.indexOf(";", m.index);
        const chain = src.slice(m.index, end === -1 ? undefined : end);
        if (!/^\.from\("item_addons"\)\s*\.select\(/.test(chain)) continue;
        reads++;
        const before = src.slice(Math.max(0, m.index - 400), m.index);
        const call = before.lastIndexOf("everyRow");
        const paged = call !== -1 && !before.slice(call).includes(".from(") && /\.range\(/.test(chain);
        if (!paged && !/\.eq\("product_id",/.test(chain)) offenders.push(`${f}: .from("item_addons") read in one request`);
      }
    }
    expect(reads, "the scan found no read of item_addons").toBeGreaterThanOrEqual(2);
    expect(offenders, `extras reads that stop at the row cap — page them with everyRowIn:\n${offenders.join("\n")}`).toEqual([]);
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

describe("a request whose answer nobody reads", () => {
  // Only where losing it costs nothing AND nothing on screen says it landed.
  const MAY_DISCARD: Record<string, string> = {
  };

  it("reads the answer of every request that tells somebody it worked", () => {
    // "Llamar al mesero" fired its request, threw the answer away and said
    // "¡En camino!" for a minute whatever came back: a rate limit from the
    // room's Wi-Fi, a table that no longer exists, no connection at all. The
    // bill's own waiter button had been fixed for exactly this, and this one
    // had not.
    const offenders: string[] = [];
    for (const file of walkAll("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const fired = /^\s*(await|void)\s+fetch\(/m.test(code);
      // A browser write straight to the database is a request too: the waiter
      // bar hid a call before its "done" was written and never looked back.
      const written = /^\s*(await|void)\s+(supabase|createClient\(\))\s*\.from\(/m.test(code) &&
        (file.startsWith("src/components/") || file.startsWith("src/hooks/"));
      if ((fired || written) && !(file in MAY_DISCARD)) offenders.push(file);
    }
    expect(offenders, `a request fired and its answer ignored:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("only excuses files that still discard an answer", () => {
    const stale = Object.keys(MAY_DISCARD).filter(f => !/^\s*(await|void)\s+fetch\(/m.test(read(f)));
    expect(stale, `excused but no longer discarding — drop the excuse:\n${stale.join("\n")}`).toEqual([]);
  });
});

describe("a dashboard page reads or refuses", () => {
  // The bills board and the analytics page (with the corte) destructured their
  // reads as `{ data }` and took a failure as empty: "no open tables", nothing
  // already collected so the whole bill looked owing again, a drawer holding
  // nothing, a day with no sales. The rest of the dashboard did it too: every
  // table free, a waiter's pad with no tables, a printer "never set up" that
  // invited a new token, a menu that seemed deleted. Every page's reads are
  // unwrapped, and a failure renders the error screen that offers a retry.
  const SCREENS = walkAll("src/app/dashboard").filter(f => f.endsWith("/page.tsx"));

  it("takes no read's data without its error", () => {
    const offenders: string[] = [];
    for (const file of SCREENS) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const m of code.matchAll(/(?:const|let)\s+(?:\[\s*)?\{\s*data\b[^}]*\}(?:[^=]*\])?\s*=/g)) {
        offenders.push(`${file}: ${m[0].replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders, `a read whose failure is shown as nothing:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("a list replaced wholesale is put back when the new one fails", () => {
  // Editing a promotion or an icon group deletes the old list and inserts the
  // new one. Promotions now use a transaction (offers-schema.spec.ts). Neither
  // delete was checked, and a failed insert (a dish another
  // manager deleted mid-edit is a foreign-key refusal) left a promotion active
  // with no products, and an icon group empty under "saved".
  const REPLACERS: [string, string, RegExp][] = [
    ["src/app/api/icon-groups/route.ts", "icon_group_items", /insert\(before\.map\(/],
  ];

  it("reads the old list first, checks the clear, and restores it", () => {
    const offenders: string[] = [];
    for (const [file, table, restore] of REPLACERS) {
      const code = read(file).replace(/\/\/.*$/gm, "");
      const readsFirst = new RegExp(`from\\("${table}"\\)\\.select\\(`).test(code);
      const checksClear = new RegExp(`\\{ error: \\w+ \\} = await db\\.from\\("${table}"\\)\\.delete\\(\\)`).test(code);
      if (!readsFirst || !checksClear || !restore.test(code)) offenders.push(file);
    }
    expect(offenders, `a replaced list that is lost when the new one fails:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("every list of logins reads every page", () => {
  it("lists logins only through the helpers that page", () => {
    // `auth.admin.listUsers` answers one page and says nothing about the rest.
    // The platform admin's list stopped at the thousandth login, and the
    // checks looked a login up among the first 200 — about forty cafés —
    // after which prod-check would report the demo logins missing and the api
    // gate would leave its signup's test login behind.
    const helpers = ["src/lib/logins.ts", "scripts/logins.mjs"];
    const files = [...walk("src"), ...walkAll("scripts")].filter(f => /\.(ts|tsx|mjs|cjs|js)$/.test(f) && !f.includes("__tests__"));
    const callers = files.filter(f => /\.listUsers\(/.test(read(f)));
    expect(callers.filter(f => helpers.includes(f)).sort(), "the paging helpers no longer list logins").toEqual([...helpers].sort());
    expect(callers.filter(f => !helpers.includes(f)), "list logins with everyLogin / loginByEmail, which read every page").toEqual([]);
  });
});
