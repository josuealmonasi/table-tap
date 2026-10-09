// ============================================================================
// What a change can reach, and therefore which gates it needs.
//
// The whole gate takes well over an hour, and most of it re-checks screens a
// change cannot touch: a new search box does not need the login page opened
// in four widths. So this reads the diff, follows the import graph UP from
// every changed file to the pages and API routes that use it, and gives each
// gate only that slice — every page that imports a changed component, however
// indirectly, and nothing that does not.
//
// A changed export reaches only the importers that take it; a changed CSS
// rule reaches the components that spell its classes; a changed line of copy
// reaches the screens that use its key. Whatever cannot be pinned down that
// way reaches everything: the root layout, middleware, the Supabase clients,
// the dependency set, the schema, the seed, a gate's shared code, a CSS token.
//
// What an import graph cannot see — two screens that agree only through the
// database — is what the full run (`pnpm gate --all`) is for, and the loop
// runs it before every merge to main.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { changedFiles, sides, walk, importers, changedExports, reach, keyUsers } from "./gate-graph.mjs";
import { changedClasses, classUsers } from "./gate-css.mjs";

const STYLESHEET = "src/app/globals.css";

/** Changes that can reach every screen and every route. */
const EVERYTHING = [
  /^src\/app\/layout\.tsx$/,
  /^src\/middleware\.ts$/,
  /^src\/lib\/supabase\//,
  /^package\.json$/, /^pnpm-lock\.yaml$/, /^next\.config\./, /^tsconfig\.json$/, /^vitest\.config\./,
  /^public\//,
  // The schema and the seed decide what every gate finds when it looks.
  /^supabase\//,
  /^scripts\/(db|mock-[\w-]+|seed-[\w-]+|test-users|menu-catalog|demo-reset|hold-writes)\.mjs$/,
  // Shared by every gate.
  /^scripts\/(dev-url|preflight|gate-scope|gate-plan|gate-graph|gate-css|gate)\.mjs$/,
];

/** Code money moves through. Touch any of it and money and attack run. */
const MONEY = /^src\/(app\/api\/(checkout|bill|table-payment|pos|split|refunds-due|orders\/cancel|webhooks|account|accounts|coupons|loyalty)|lib\/(checkout|card-settle|part-payment|stock|coupon|refund-due|pricing|account|bill-|money|payment|pos-|table-payment|subscription-sync|admin-plan|plan))/;

/** Who may reach what. Touch any of it and roles, rls and api run in full. */
const GUARDS = /^src\/(lib\/(api-guard|page-guard|membership|admin|current-user|plan-guard)|components\/layout\/)/;

/** A gate's own code: changing it runs that gate in full. */
const GATE_FILES = {
  api: /^scripts\/api-/,
  rls: /^scripts\/rls-/,
  roles: /^scripts\/roles-/,
  smoke: /^scripts\/smoke/,
  layout: /^scripts\/layout-/,
  promises: /^scripts\/promise-/,
  money: /^scripts\/money-/,
  attack: /^scripts\/attack-/,
  dialogs: /^scripts\/(dialog-|layout-paths)/,
};

export const BROWSER_GATES = ["roles", "smoke", "layout", "promises", "dialogs"];
export const ORDER = ["tsc", "lint", "test", "api", "rls", "roles", "smoke", "layout", "promises", "money", "attack", "dialogs"];

/** The components a stylesheet change shows in, or "*". */
function styleUsers(base, files, committedOnly) {
  if (!files.includes(STYLESHEET)) return [];
  const { oldText, newText, oldLines, newLines } = sides(base, STYLESHEET, committedOnly);
  if (oldText === null || newText === null) return "*";
  const before = changedClasses(oldText, oldLines);
  const after = changedClasses(newText, newLines);
  if (before === "*" || after === "*") return "*";
  const users = classUsers(new Set([...before, ...after]), walk());
  return users === "*" ? "*" : [...users];
}

/**
 * A page or route file as the URL pattern a gate's list would hold. A dynamic
 * segment does not match its static siblings: Next serves /dashboard/bills
 * from bills/, never from [menu]/, so [menu] must not pull bills into a run.
 */
export function urlPattern(file, kind) {
  const parts = path.dirname(file).split("/").slice(2); // past src/app
  let source = "";
  let dir = "src/app";
  for (const seg of parts) {
    if (/^\(.+\)$/.test(seg)) { dir = path.join(dir, seg); continue; } // route groups are not in the URL
    if (/^\[.+\]$/.test(seg)) {
      const statics = fs.existsSync(dir)
        ? fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && /^[\w-]+$/.test(e.name)).map(e => e.name)
        : [];
      source += "/" + (statics.length ? `(?!(?:${statics.join("|")})(?:/|$))[^/]+` : "[^/]+");
    } else source += "/" + seg.replace(/[.*+?^${}()|\\]/g, "\\$&");
    dir = path.join(dir, seg);
  }
  if (kind === "layout") return `^${source}(/.*)?$`;
  return `^${source || "/"}$`;
}

/** The plan: which gates run, on what, and why each one does or does not. */
export function plan({ base = "origin/main", all = false, committedOnly = false } = {}) {
  const files = changedFiles(base, committedOnly);
  const decide = (name, run, why, scope = {}) => ({ name, run, why, scope });
  if (all) return { files, reached: null, gates: ORDER.map(g => decide(g, true, "full run asked for")) };

  const styled = styleUsers(base, files, committedOnly);
  const copy = keyUsers(base, files, committedOnly);
  const everything = files.filter(f => EVERYTHING.some(re => re.test(f)));
  if (styled === "*") everything.push(`a ${STYLESHEET} change no class pins down`);
  if (copy === "*") everything.push("copy looked up by a built key");

  const srcChanged = files.filter(f => /^src\/.*\.(ts|tsx)$/.test(f) && !/__tests__|__stories__/.test(f)).map(f => path.normalize(f));
  const seeds = [...srcChanged, ...(styled === "*" ? [] : styled), ...(copy === "*" ? [] : copy)];
  const reached = reach(seeds, importers(), f => (srcChanged.includes(f) ? changedExports(base, f, committedOnly) : "*"));

  const pages = new Set();
  const api = new Set();
  for (const f of reached) {
    if (f.startsWith("src/app/api/")) {
      if (/\/route\.ts$/.test(f)) api.add(urlPattern(f, "page"));
    } else if (/^src\/app\/(.*\/)?page\.tsx$/.test(f)) pages.add(urlPattern(f, "page"));
    else if (/^src\/app\/(.*\/)?(layout|loading|error|not-found|template)\.tsx$/.test(f)) pages.add(urlPattern(f, "layout"));
  }
  const money = [...reached].some(f => MONEY.test(f));
  const guards = [...reached].some(f => GUARDS.test(f));
  const own = g => files.some(f => GATE_FILES[g].test(f));

  const gates = [decide("tsc", true, "always"), decide("lint", true, "always"), decide("test", true, "always")];
  for (const g of ORDER.slice(3)) {
    if (everything.length) gates.push(decide(g, true, `${everything[0]} reaches everything`));
    else if (g === "smoke") gates.push(decide(g, true, "always: it reads every page in about a minute"));
    else if (own(g)) gates.push(decide(g, true, "its own script changed"));
    else if (guards && ["api", "rls", "roles"].includes(g)) gates.push(decide(g, true, "access code is in reach"));
    else if (g === "api") gates.push(api.size ? decide(g, true, `${api.size} route(s) in reach`, { GATE_API: [...api] }) : decide(g, false, "no change reaches an API route"));
    else if (g === "rls") gates.push(decide(g, false, "no schema or access change in reach"));
    else if (g === "money" || g === "attack") gates.push(money ? decide(g, true, "a money path is in reach") : decide(g, false, "no money path in reach"));
    else if (g === "roles") {
      // Roles opens pages and calls routes; a scoped run does both for what is in reach.
      gates.push(pages.size || api.size
        ? decide(g, true, `${pages.size} page(s) and ${api.size} route(s) in reach`, { GATE_PAGES: [...pages], GATE_API: [...api] })
        : decide(g, false, "no change reaches a page or a route"));
    } else gates.push(pages.size ? decide(g, true, `${pages.size} page(s) in reach`, { GATE_PAGES: [...pages] }) : decide(g, false, "no change reaches a page"));
  }
  return { files, reached: [...reached], gates };
}

// `node scripts/gate-plan.mjs [--all] [--base ref] [--committed] [--verbose]` prints the plan.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "origin/main";
  const p = plan({ base, all: args.includes("--all"), committedOnly: args.includes("--committed") });
  console.log(`\n${p.files.length} changed file(s) against ${base}; ${p.reached?.length ?? "all"} file(s) in reach.\n`);
  for (const g of p.gates) {
    const scope = Object.entries(g.scope).map(([k, v]) => `${k}=${v.length}`).join(" ");
    console.log(`  ${g.run ? "run " : "skip"}  ${g.name.padEnd(9)} ${g.why}${scope ? `  [${scope}]` : ""}`);
    if (args.includes("--verbose")) for (const v of Object.values(g.scope).flat()) console.log(`              ${v}`);
  }
}
