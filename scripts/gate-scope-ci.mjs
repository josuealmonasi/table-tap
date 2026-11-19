// ============================================================================
// Which pages a browser gate opens on GitHub (.github/workflows/gates.yml).
//
//   node scripts/gate-scope-ci.mjs <gate> <base> [plan|core] >> "$GITHUB_OUTPUT"
//
// The plan (gate-plan.mjs) decides, exactly as `pnpm gate` does on a laptop:
// a gate the change cannot reach does not run, and one it reaches runs on the
// pages in reach. A change that reaches EVERY screen — a seed, a package, a
// token, the root layout — runs on the core screens instead of all of them:
// the gate budget the owner set on 2026-11-14 ("fewer, optimized gates"),
// the same cap loop/gate-run.sh applies. `core` runs the core screens
// whatever the plan says, for a manual run.
// ============================================================================
import { execFileSync } from "node:child_process";
import { plan } from "./gate-plan.mjs";

/** The floor, the till, bills, accounts, settings and the diner's menu. */
export const CORE_PAGES = [
  "^/dashboard/orders$",
  "^/dashboard/bills$",
  "^/dashboard/pos$",
  "^/dashboard/accounts$",
  "^/dashboard/settings$",
  "^/r/",
];

/**
 * A page file the change adds or edits, as the route pattern the gates match.
 * `src/app/dashboard/admin/mfa/page.tsx` → `^/dashboard/admin/mfa$`; a
 * dynamic `[id]` matches any one segment; route groups `(x)` vanish.
 */
export function pagePattern(file) {
  const m = /^src\/app(.*)\/page\.tsx$/.exec(file);
  if (!m) return null;
  const route = m[1].split("/").filter(seg => seg && !/^\(.*\)$/.test(seg))
    .map(seg => (/^\[.*\]$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|\\]/g, "\\$&"))).join("/");
  return `^/${route}$`.replace("^/$", "^/$");
}

/** `{ run, pages, why }` for one browser gate, from the plan's verdict on it. */
export function browserScope(verdict, mode = "plan", changedPages = []) {
  if (mode === "core") return { run: true, pages: CORE_PAGES, why: "core screens, asked for" };
  if (!verdict) return { run: false, pages: [], why: "the plan has no such gate" };
  if (!verdict.run) return { run: false, pages: [], why: verdict.why };
  const pages = verdict.scope?.GATE_PAGES;
  if (pages?.length) return { run: true, pages, why: verdict.why };
  // Capped — but a page this change adds or edits is always opened: #703's new
  // two-step page was capped out, merged unmeasured, and broke the next PR.
  const extra = changedPages.filter(p => !CORE_PAGES.includes(p));
  return { run: true, pages: [...CORE_PAGES, ...extra],
    why: `${verdict.why}; capped to the core screens${extra.length ? ` plus ${extra.length} changed page(s)` : ""}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [gate, base = "origin/main", mode = "plan"] = process.argv.slice(2);
  const verdict = plan({ base, committedOnly: true }).gates.find(g => g.name === gate);
  const changed = execFileSync("git", ["diff", "--name-only", "--diff-filter=AM", `${base}...HEAD`], { encoding: "utf8" })
    .split("\n").map(pagePattern).filter(Boolean);
  const s = browserScope(verdict, mode, changed);
  console.log(`run=${s.run}`);
  console.log(`pages=${JSON.stringify(s.pages)}`);
  console.log(`why=${s.why.replace(/\n/g, " ")}`);
}
