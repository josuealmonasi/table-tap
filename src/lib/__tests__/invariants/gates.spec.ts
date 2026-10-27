import { describe, expect, it } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import { walkAll, read, listed, apiCaseFiles, apiCaseRegistrationErrors } from "./helpers";

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
  it("runs every imported case factory and imports every part export", () => {
    expect(apiCaseRegistrationErrors()).toEqual([]);
  });

  it("has an api case for every API route", async () => {
    expect(apiCaseFiles().filter(file => file !== "scripts/api-cases.mjs").sort(),
      "API case parts the index does not import").toEqual(
      walkAll("scripts/api-cases").filter(file => file.endsWith(".mjs")).sort(),
    );
    const { cases } = await import("../../../../scripts/api-cases.mjs");
    const fixture = {
      restaurant: { id: "restaurant" }, table: { id: "table" },
      dish: { id: "dish", price: 10 }, printToken: async () => "printer",
    };
    const inventory = cases(fixture);
    const requested = await Promise.all(inventory.map(entry =>
      typeof entry.path === "function" ? entry.path(fixture) : entry.path,
    ));
    const routes = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts"))
      .map(f => f.replace(/^src\/app/, "").replace(/\/route\.ts$/, ""));

    // Every path a returned case actually requests. A stub supplies IDs without
    // running arrange, body, check or effect callbacks against a live server.

    // A dynamic route is one pattern, not one path: `[token]` is filled in at
    // request time; the stub fixture fills in the case's path. Route parameters
    // collapse to "one segment, contents unknown" before they are compared —
    // otherwise the app's first dynamic route is matched by nothing
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
      return requested.some(path => pattern.test(path));
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

describe("a gate says when the dev server moved under it", () => {
  it("watches the dev worker in every gate that talks to the dev server", () => {
    // `next dev` recycles its worker during long sweeps, and a request in
    // flight then fails as though the code were wrong. Three false reds in one
    // day (rls, promises, layout) all passed when run again alone. A gate that
    // talks to localhost now says at exit when the worker changed under it.
    // Found by where they read the dev server's address, which is one place
    // (`dev-url.mjs`) so a gate can follow a server started on another port.
    // `gate.mjs` reads it only to ask whose server that is; every gate it runs
    // watches the worker itself.
    const gates = fs.readdirSync("scripts")
      .filter(f => f.endsWith(".mjs") && !["db.mjs", "preflight.mjs", "gate.mjs"].includes(f))
      .filter(f => read(`scripts/${f}`).includes('from "./dev-url.mjs"'));
    expect(gates.length, "no gate talks to the dev server any more — the scan broke").toBeGreaterThan(4);
    const blind = gates.filter(f => !/\b(requireServer|watchDevWorker)\(/.test(read(`scripts/${f}`)));
    expect(blind, "a gate that cannot tell a restart from a failure").toEqual([]);
  });
});

describe("a gate can run against production's CSP", () => {
  it("never waits with waitForFunction, which evals inside the page", () => {
    // Playwright runs a waitForFunction predicate through `eval` in the page,
    // even one passed as a function. Development allows `unsafe-eval` for the
    // hot reloader and production does not (src/lib/csp.ts), so `pnpm layout`
    // passed every day while `layout:prod` failed all 220 screens before
    // measuring one. Poll with `evaluate`, which the CSP does not govern.
    const files = fs.readdirSync("scripts").filter(f => f.endsWith(".mjs"));
    expect(files.length, "the scan found no scripts").toBeGreaterThan(10);
    const offenders = files.filter(f =>
      /\.waitForFunction\s*\(/.test(read(`scripts/${f}`).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")),
    );
    expect(offenders, "a gate that cannot run against the deployed site").toEqual([]);
  });
});

describe("no gate writes to production", () => {
  it("stops under --prod before the first write, in every gate that can reach it", () => {
    // `pnpm api:prod` would plant tables, orders and three payments in the live
    // ledger; `rls --prod` would have settled a real restaurant's table the
    // day a guard broke; `promises --prod` pointed the live demo at a Stripe
    // account that does not exist, and a run killed halfway left it there.
    // A script that can reach production — it reads `--prod`, the production
    // env file or the production host — and writes, itself or through a local
    // module it imports, must end the run under production before its first
    // write: `refuseProduction()`, or an `if (prod)` that exits.
    const WRITE = /\.(insert|update|upsert|delete)\(/;
    const STOP = /refuseProduction\(|if \(prod\) \{[^}]*?(process\.exit|finish)\(/;
    const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const scripts = fs.readdirSync("scripts").filter(f => f.endsWith(".mjs"));
    const writesItself = (f: string) => WRITE.test(strip(read(`scripts/${f}`)));
    const offenders: string[] = [];
    let writers = 0;
    let reachProduction = 0;
    for (const file of scripts) {
      const code = strip(read(`scripts/${file}`));
      // Names imported from a local module that writes are writes when called.
      const imported = [...code.matchAll(/import \{([^}]+)\} from "\.\/([\w-]+\.mjs)"/g)]
        .filter(m => scripts.includes(m[2]) && writesItself(m[2]))
        .flatMap(m => m[1].split(",").map(n => n.trim().split(/\s+as\s+/).pop() ?? ""))
        .filter(Boolean);
      // Browser contexts remove their own pending phones only in development.
      // A literal `if (!prod)` around that imported call is a guard too; its
      // else branch is deliberately outside the range and stays checked.
      const developmentOnly: [number, number][] = [];
      const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const visit = (node: ts.Node): void => {
        if (ts.isIfStatement(node) && node.expression.getText(source).replace(/\s/g, "") === "!prod") {
          developmentOnly.push([node.thenStatement.getStart(source), node.thenStatement.end]);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      const calls = imported.length ? new RegExp(`\\b(${imported.join("|")})\\(`, "g") : null;
      const writesCalled = calls ? [...code.matchAll(calls)].map(match => match.index!)
        .filter(at => !developmentOnly.some(([start, end]) => at >= start && at < end)) : [];
      const firsts = [code.search(WRITE), ...writesCalled].filter(i => i >= 0);
      if (!firsts.length) continue;
      writers++;
      if (!/--prod|\.env\.production\.local|PROD_SITE_URL/.test(code)) continue;
      reachProduction++;
      const firstWrite = Math.min(...firsts);
      const stop = code.search(STOP);
      if (stop < 0 || stop > firstWrite) {
        offenders.push(`scripts/${file}: writes at "${code.slice(firstWrite, firstWrite + 40).split("\n")[0]}" with nothing stopping it under --prod`);
      }
    }
    expect(writers, "the scan found no gate that writes — it broke").toBeGreaterThanOrEqual(4);
    expect(reachProduction, "no writing gate reaches production any more — the scan broke").toBeGreaterThanOrEqual(1);
    expect(offenders, `a gate that would write to production:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("prod:check compares what each permission is, not only its name", () => {
  it("fingerprints policy bodies, RLS flags, grants and function rights", () => {
    // It compared policies and functions by name. A policy rewritten in
    // schema.sql and never applied to production, a table with RLS switched
    // off there, or a function handed back to anon all kept their names, and
    // all passed. `pnpm rls` refuses production, so this equality is the only
    // thing that proves production's permissions are the ones development's
    // were proven to be.
    const src = read("scripts/prod-check.mjs");
    const must: [string, RegExp][] = [
      ["each policy's using and check", /\bqual\b[\s\S]*\bwith_check\b/],
      ["each policy's command and roles", /\bcmd\b[\s\S]*\broles\b/],
      ["whether each table has RLS on", /relrowsecurity/],
      ["what authenticated may read", /grantee = 'authenticated'/],
      ["table-level grants", /role_table_grants/],
      ["each function's owner rights and search path", /prosecdef[\s\S]*proconfig/],
      ["who may execute each function", /has_function_privilege\('anon'[\s\S]*has_function_privilege\('authenticated'/],
      ["each function's source", /md5\(p\.prosrc\)/],
    ];
    const missing = must.filter(([, re]) => !re.test(src)).map(([what]) => what);
    expect(missing, "prod:check no longer compares").toEqual([]);
  });
});

describe("the attack gate leaves nothing behind when a case throws", () => {
  it("marks every table it makes and sweeps by that mark before and after", () => {
    // Each case tidied up after itself only when it finished. A dev worker
    // restart threw one mid-race, and a MX$200 cash payment stayed on a sitting
    // with no order — the next `pnpm money` would have called it a real
    // overpayment. The sweep finds everything from the tables' labels, so a
    // table made without the mark is a table it cannot find.
    const src = read("scripts/attack-money.mjs").replace(/\/\/.*$/gm, "");
    const inserts = [...src.matchAll(/from\("restaurant_tables"\)\s*\.insert\(\{([^}]*)\}/g)].map(m => m[1]);
    expect(inserts.length, "the scan found no table the gate makes").toBeGreaterThan(3);
    const unmarked = inserts.filter(body => !/label:\s*(MARK\b|`\$\{MARK)/.test(body));
    expect(unmarked, "a table the sweep cannot find").toEqual([]);

    const firstInsert = src.search(/\.insert\(/);
    const firstSweep = src.search(/^await sweep\(\);$/m);
    expect(firstSweep, "no sweep before the first row is planted").toBeGreaterThanOrEqual(0);
    expect(firstSweep, "the sweep runs after something was already planted").toBeLessThan(firstInsert);
    const lastFinally = src.lastIndexOf("} finally {");
    expect(src.indexOf("await sweep();", lastFinally), "the last finally does not sweep").toBeGreaterThan(lastFinally);
  });
});

describe("a gate that reads production writes nothing there", () => {
  it("probes every write in the roles gate with a body the route turns down", () => {
    // The roles gate sent real bodies: `roles:prod` made a live 5% coupon,
    // ZZZ-999, on the demo restaurant and re-sent it on every run. Each write
    // now names the one answer an allowed role may get, and nothing else passes.
    const src = read("scripts/roles-check.mjs");
    const block = src.slice(src.indexOf("const ROUTES = ["), src.indexOf("];", src.indexOf("const ROUTES = [")));
    const writes = [...block.matchAll(/\{\s*m:\s*"(POST|PATCH|PUT|DELETE)"[^\n]*/g)].map(m => m[0]);
    expect(writes.length, "the scan found no write in the roles gate").toBeGreaterThan(2);
    const unguarded = writes.filter(w => !/\bpasses:\s*\d{3}\b/.test(w));
    expect(unguarded, "a write probe that says nothing about what it may be answered").toEqual([]);
  });

  it("holds every write in the browser, in every browser gate that can reach it", () => {
    // A layout or promise sweep clicks dialogs open and walks a diner to the
    // cart; against production one wrong click is an order in a real
    // restaurant's books. Every context those gates open answers writes in the
    // browser, the way the dialog sweep's always has.
    const gates = fs.readdirSync("scripts")
      .filter(f => f.endsWith(".mjs"))
      .filter(f => { const s = read(`scripts/${f}`); return s.includes("chromium") && s.includes("--prod"); });
    expect(gates.length, "no browser gate reaches production — the scan broke").toBeGreaterThanOrEqual(3);
    const offenders: string[] = [];
    for (const f of gates) {
      const lines = read(`scripts/${f}`).split("\n");
      lines.forEach((line, i) => {
        if (!/browser\.newContext\(/.test(line) || line.trim().startsWith("//")) return;
        if (!lines.slice(i, i + 4).some(l => /holdWrites\(/.test(l))) offenders.push(`scripts/${f}:${i + 1}`);
      });
    }
    expect(offenders, "a browser context that could write to production").toEqual([]);
  });
});

describe("every promise case is a case of its own", () => {
  it("exports one state for every name the file declares", async () => {
    // A conflict resolved by keeping both sides dropped one case's closing
    // brace and the next one's opening: two cases became one object with
    // duplicate keys, the later won, and "Caja · the till" stopped running
    // without a line in the output to say so.
    const { STATES } = await import("../../../../scripts/promise-cases.mjs");
    const names = [...read("scripts/promise-cases.mjs").matchAll(/^ {4}name: "/gm)].length;
    expect(names, "the scan found no case").toBeGreaterThan(20);
    expect(STATES.length, "a case swallowed by the one before it").toBe(names);
  });
});
