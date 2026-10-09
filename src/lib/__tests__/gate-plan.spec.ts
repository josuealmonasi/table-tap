import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { urlPattern } from "../../../scripts/gate-plan.mjs";
import { reach } from "../../../scripts/gate-graph.mjs";
import { changedClasses, classUsers } from "../../../scripts/gate-css.mjs";

/**
 * `pnpm gate` checks only what a change can reach. Every way that can go
 * wrong is a gate going green over a screen it never opened, so each piece of
 * the plan is held here against the real app: its pages, its API routes, its
 * stylesheet.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** A page file as a URL a person opens, its parameters filled in. */
const urlOf = (file: string): string =>
  file
    .replace(/^src\/app/, "")
    .replace(/\/\([^)]+\)/g, "")
    .replace(/\/page\.tsx$|\/route\.ts$/, "")
    .replace(/\[[^\]]+\]/g, "_") || "/";

describe("the gate's scope", () => {
  const pages = walk("src/app").filter(f => f.endsWith("page.tsx") && !f.startsWith("src/app/api/"));
  const routes = walk("src/app/api").filter(f => f.endsWith("route.ts"));

  it("matches every page by its own pattern, and no other page", () => {
    for (const page of pages) {
      const re = new RegExp(urlPattern(page, "page"));
      expect(re.test(urlOf(page)), `${page} → ${urlPattern(page, "page")}`).toBe(true);
      const others = pages.filter(p => p !== page && re.test(urlOf(p)));
      expect(others, `${page}'s pattern also matches`).toEqual([]);
    }
  });

  it("matches the paths the gates' own lists hold", () => {
    // What layout, dialogs and promises open, as written in their list.
    const listed = [...fs.readFileSync("scripts/layout-paths.mjs", "utf8").matchAll(/"(\/[^"]*)"/g)].map(m => m[1].split("?")[0]);
    const unmatched = listed.filter(p => !pages.some(page => new RegExp(urlPattern(page, "page")).test(p)));
    expect(unmatched, "listed screens no page pattern matches — a scoped run would never open them").toEqual([]);
    // And every API case's path, with its `${...}` filled in.
    const requested = [...fs.readFileSync("scripts/api-cases.mjs", "utf8").matchAll(/path:\s*[`"']([^`"']+)/g)]
      .map(m => m[1].replace(/\$\{[^}]*\}/g, "x").split("?")[0]);
    const unrouted = requested.filter(p => !routes.some(r => new RegExp(urlPattern(r, "page")).test(p)));
    expect(unrouted, "api cases no route pattern matches").toEqual([]);
  });

  it("leaves route groups out of the URL", () => {
    // None in the app today; the first one must not fall out of every run.
    expect(urlPattern("src/app/(site)/menu/page.tsx", "page")).toBe("^/menu$");
  });

  it("takes a layout to every page under it", () => {
    expect(new RegExp(urlPattern("src/app/layout.tsx", "layout")).test("/dashboard/admin")).toBe(true);
    const dash = new RegExp(urlPattern("src/app/dashboard/layout.tsx", "layout"));
    expect(dash.test("/dashboard")).toBe(true);
    expect(dash.test("/dashboard/bills")).toBe(true);
    expect(dash.test("/login")).toBe(false);
  });
});

describe("what a change reaches", () => {
  // page ← Panel ← format.ts: Panel takes `money`, Other takes `date`.
  const users = new Map<string, Map<string, Set<string> | "*">>([
    ["format.ts", new Map<string, Set<string> | "*">([["Panel.tsx", new Set(["money"])], ["Other.tsx", new Set(["date"])]])],
    ["Panel.tsx", new Map<string, Set<string> | "*">([["page.tsx", "*"]])],
  ]);

  it("follows only the importers that take a changed export", () => {
    const reached = reach(["format.ts"], users, () => new Set(["money"]));
    expect([...reached].sort()).toEqual(["Panel.tsx", "format.ts", "page.tsx"]);
  });

  it("follows every importer when the change is not one export", () => {
    const reached = reach(["format.ts"], users, () => "*");
    expect(reached.has("Other.tsx")).toBe(true);
  });
});

describe("what a stylesheet change reaches", () => {
  const sheet = [
    ":root {", //               1
    "  --tt-ink: #111;", //     2
    "}", //                     3
    ".tt-a,", //                4
    ".tt-b:hover {", //         5
    "  color: red;", //         6
    "}", //                     7
    "@media (max-width: 700px) {", // 8
    "  .tt-c > * { margin: 0; }", //  9
    "}", //                     10
    "h2 { margin: 0; }", //     11
  ].join("\n");

  it("pins a rule's lines to the classes it names", () => {
    expect([...changedClasses(sheet, new Set([6]))].sort()).toEqual(["tt-a", "tt-b"]);
    expect([...changedClasses(sheet, new Set([8]))]).toEqual(["tt-c"]);
  });

  it("reaches everything for a token, a bare element or a line outside every rule", () => {
    expect(changedClasses(sheet, new Set([2]))).toBe("*");
    expect(changedClasses(sheet, new Set([11]))).toBe("*");
    expect(changedClasses(sheet + "\n@import url(x);", new Set([12]))).toBe("*");
  });

  it("finds the components that spell a class, and gives up on one nobody spells", () => {
    const files = walk("src").filter(f => /\.tsx?$/.test(f) && !f.includes("__tests__"));
    expect([...classUsers(new Set(["tt-admin-role"]), files)]).toContain("src/components/dashboard/admin/AdminPanel.tsx");
    expect(classUsers(new Set(["tt-no-component-spells-this"]), files)).toBe("*");
  });
});
