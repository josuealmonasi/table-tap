// ============================================================================
// Which pages and routes this gate run is about.
//
// `pnpm gate` works out what a change can reach — the files that changed, and
// everything that imports them — and hands each gate the pages and API routes
// in that reach through GATE_PAGES and GATE_API (JSON arrays of regex
// sources). Unset, every gate checks everything, exactly as it always has.
//
// A gate that was given a scope and then matched nothing in it has checked
// nothing, which prints the same as having passed — so `reportScope` says it.
// ============================================================================

const parse = name => {
  const raw = process.env[name];
  if (!raw) return null;
  return JSON.parse(raw).map(source => new RegExp(source));
};

const PAGES = parse("GATE_PAGES");
const API = parse("GATE_API");
const seen = { pages: { in: 0, out: 0 }, api: { in: 0, out: 0 } };

function test(list, bucket, path) {
  if (!list) return true;
  const hit = list.some(re => re.test(path));
  seen[bucket][hit ? "in" : "out"]++;
  return hit;
}

/** Whether a page belongs to this run. Always true when no scope was given. */
export const pageInScope = path => test(PAGES, "pages", path.split("?")[0]);

/** Whether an API case belongs to this run. Always true when no scope was given. */
export const apiInScope = path => test(API, "api", path.split("?")[0]);

/** Whether this run was scoped at all, for gates that print it. */
export const scoped = () => Boolean(PAGES || API);

/**
 * Says how much of the gate the scope covered. A gate whose lists hold none
 * of a change's pages checked nothing, and says so in words `pnpm gate` reads
 * back into its summary — never silently, and never as a failure: dialogs
 * opens no diner screen, so a diner-only change has nothing for it to check.
 * That the patterns can match at all is held by gate-plan.spec.ts, which runs
 * every page in the app through them against the lists the gates hold.
 */
export function reportScope(gate) {
  for (const [bucket, list] of [["pages", PAGES], ["api", API]]) {
    if (!list) continue;
    const { in: hit, out } = seen[bucket];
    console.log(`  scope: ${gate} checked ${hit} ${bucket === "api" ? "case(s)" : "page visit(s)"} in this change's reach, skipped ${out}`);
  }
}
