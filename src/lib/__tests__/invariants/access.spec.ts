import { describe, expect, it } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import path from "node:path";
import { walk, walkAll, sources, read } from "./helpers";

describe("server code takes only components from a client module", () => {
  it("never imports a runtime value from a \"use client\" file into server code", () => {
    // The costs page — a server component — imported its tab list, an array,
    // from a "use client" component. Next hands the server a client reference
    // in its place, so `COSTS_TABS.includes(...)` threw and every costs tab
    // failed to render; caught by a browser walk before release (#486). A
    // client module's components may cross into server code (React renders
    // them); its values, functions and hooks may not. Type imports are erased.
    const isClient = (f: string) => /^\s*["']use client["']/.test(read(f));
    const resolve = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/") ? path.join("src", spec.slice(2))
        : spec.startsWith(".") ? path.join(path.dirname(from), spec) : null;
      if (!base) return null;
      for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
      }
      return null;
    };
    const servers = walk("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__")
      && (f.startsWith("src/app/") || f.startsWith("src/lib/")) && !isClient(f));
    const offenders: string[] = [];
    let crossings = 0;
    for (const f of servers) {
      const source = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true);
      for (const node of source.statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
        const clause = node.importClause;
        if (!clause || clause.isTypeOnly) continue;
        const target = resolve(f, node.moduleSpecifier.text);
        if (!target || !isClient(target)) continue;
        crossings++;
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          offenders.push(`${f}: * as ${bindings.name.text} from ${node.moduleSpecifier.text}`);
          continue;
        }
        for (const el of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
          if (el.isTypeOnly) continue;
          const name = (el.propertyName ?? el.name).text;
          // A component is PascalCase; a constant, a function or a hook is not.
          if (!/^[A-Z][a-z0-9]/.test(name)) offenders.push(`${f}: { ${name} } from ${node.moduleSpecifier.text}`);
        }
      }
    }
    expect(crossings, "the scan found no server import of a client module").toBeGreaterThan(10);
    expect(offenders, `values imported from "use client" modules into server code — move them to a plain module:\n${offenders.join("\n")}`).toEqual([]);
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
        !/acting(Staff|FrontOfHouse|Manager|Owner)|deskMutation|isRateLimited|isRoomLimited|getPlatformAdmin|stripe-signature|readStripeEvent|cronAuthorized/.test(
          read(f),
        ),
    );
    expect(naked, `no guard and no rate limit: ${naked.join(", ")}`).toEqual([]);
  });

  it("counts a diner's write per table, with the room counted first", () => {
    // Every write was limited per address, sized for one phone, and a
    // restaurant's Wi-Fi is one address for the whole room. A public route
    // that is told its table counts it (`isTableLimited`), after the room
    // (`isRoomLimited`) and before it reads the body — so an invented table
    // meets the room's ceiling before it opens a counter of its own.
    const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const publicWrites = walk("src/app/api")
      .filter(f => f.endsWith("route.ts"))
      .filter(f => /isRateLimited|isRoomLimited/.test(read(f)))
      .filter(f => /export async function POST/.test(read(f)) && /tableId\??:\s*string/.test(read(f)));
    expect(publicWrites.length, "the scan found no public write that takes a table").toBeGreaterThan(4);
    const offenders = publicWrites.filter(f => {
      const src = code(f);
      const post = src.slice(src.indexOf("export async function POST"));
      const room = post.indexOf("isRoomLimited(");
      return room === -1 || room > post.indexOf("jsonBody") || !/isTableLimited\(req, "[a-z-]+", (tableId|typeof tableId)/.test(post);
    });
    expect(offenders, `a public write that does not count its table:\n${offenders.join("\n")}`).toEqual([]);
    // The receipt learns its table from the order or slot payment it reads.
    expect(code("src/app/api/receipt/route.ts")).toMatch(/isTableLimited\(req, "receipt", source\.tableId/);
  });
});

describe("each module sits behind the right guard", () => {
  // A module moved from one screen to another inherits that screen's audience.
  // The history is in analytics and the manager-only returns section of the
  // orders board; the activity log moved out of staff, which only the owner
  // can open, and into bills, which a waiter can open. Getting the host
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
    // The activity log must not keep an audience it lost. Returns deliberately
    // put history back on Pedidos, behind its own manager predicate.
    const old = {
      UserLogs: "src/components/dashboard/staff/StaffPanel.tsx",
    };
    for (const [mod, file] of Object.entries(old)) {
      expect(read(file), `${file} still renders ${mod}`).not.toMatch(new RegExp(`<${mod}[\\s/>]`));
    }
  });

  it("keeps completed-sale returns behind the board's manager predicate", () => {
    const board = read("src/components/dashboard/OrdersBoard.tsx");
    expect(board).toMatch(/canApprove && !kitchen && <>\s*<OrderReturnsPanel[^>]*\/>\s*<OrderHistory[^>]*canReturn/);
    expect(read("src/app/dashboard/orders/page.tsx")).toContain("canApprove={MANAGES(membership.role)}");
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

    // The options are drawn from one list, and a tier narrows it
    // (`assignableRoles` — Caja has no kitchen board and no tables), so the
    // list itself is what must name every role.
    const picker = read("src/components/dashboard/staff/StaffPanel.tsx");
    const listed = picker.match(/const ALL_ROLES: StaffRole\[\] = \[([^\]]*)\]/);
    expect(listed, "the team screen no longer draws its roles from one list").toBeTruthy();
    expect(picker, "the invite form does not render the list it was given").toMatch(/roles\.map\(r =>/);
    for (const role of hired) {
      expect(listed![1], `no way to hire a "${role}"`).toContain(`"${role}"`);
    }

    const schema = read("supabase/schema.sql");
    const check = schema.match(/staff_role_check\s*\n?\s*check \(role in \(([^)]*)\)\)/);
    expect(check, "the staff role constraint moved").toBeTruthy();
    for (const role of ROLES) {
      expect(check![1], `the database rejects "${role}"`).toContain(`'${role}'`);
    }
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

describe("a link the app sends is built on its own address", () => {
  it("never reads the caller's Origin header", () => {
    // A script set Origin to another site, and the statement email the app
    // sent from its own verified sender carried a "pay" link there.
    const offenders = sources.filter(f => /headers\.get\(\s*["']origin["']\s*\)/i.test(read(f)));
    expect(offenders).toEqual([]);
    expect(sources.filter(f => /siteOrigin\(req\)/.test(read(f))).length).toBeGreaterThanOrEqual(9);
  });
});
