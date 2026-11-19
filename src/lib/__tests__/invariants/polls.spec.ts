import { describe, expect, it } from "vitest";
import ts from "typescript";
import { walk, read } from "./helpers";

/** Calls that go over the network (the admission helpers wrap `fetch`). */
const NETWORK = new Set(["fetch", "membershipRead", "requestPhoneMembership"]);

/** `router.refresh()` re-renders the page on the server: a network read too. */
function isRouterRefresh(node: ts.Node): boolean {
  return ts.isPropertyAccessExpression(node) && node.name.text === "refresh"
    && ts.isIdentifier(node.expression) && /router$/i.test(node.expression.text);
}

/** A React state setter's name; the timer functions are not state. */
const isSetter = (name: string): boolean => /^set[A-Z]/.test(name) && !/^set(Timeout|Interval|Immediate)$/.test(name);

/** `setNow(Date.now())`: a clock tick, the one thing a fixed interval may set. */
function isClockSet(node: ts.CallExpression): boolean {
  const text = node.arguments.map(a => a.getText()).join(",");
  return /Date\.now\(\)|new Date\(|performance\.now\(\)/.test(text);
}

/**
 * The lines of every `setInterval` that polls the network on a fixed tick:
 * - its callback reaches the network, following calls to functions declared
 *   in the same file (`read`, `() => void load()`, `router.refresh()`), or
 * - the file reads the network and the callback sets state other than a
 *   clock. `setInterval(() => setAttempt(n => n + 1))` with `attempt` in an
 *   effect's dependencies is a fixed-tick fetch with one step in between.
 */
function intervalFetches(file: string, text = read(file)): number[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const functions = new Map<string, ts.Node>();
  const collect = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) functions.set(node.name.text, node.body);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      // `const read = async () => …`, and `const load = useCallback(async () => …, [])`.
      const init = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) functions.set(node.name.text, init.body);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  const reaches = (node: ts.Node, seen: Set<string>): boolean => {
    if (isRouterRefresh(node)) return true;
    if (ts.isIdentifier(node)) {
      if (NETWORK.has(node.text)) return true;
      const body = functions.get(node.text);
      if (body && !seen.has(node.text)) { seen.add(node.text); if (reaches(body, seen)) return true; }
      return false;
    }
    return ts.forEachChild(node, child => reaches(child, seen) || undefined) ?? false;
  };
  const fileFetches = reaches(source, new Set());
  /** State set from the callback, directly or through a named function, other than a clock. */
  const setsState = (node: ts.Node, seen: Set<string>): boolean => {
    if (ts.isCallExpression(node) && isSetter(node.expression.getText()) && !isClockSet(node)) return true;
    if (ts.isIdentifier(node)) {
      if (isSetter(node.text) && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) return true; // `setInterval(setTick, …)`
      const body = functions.get(node.text);
      if (body && !seen.has(node.text)) { seen.add(node.text); return setsState(body, seen); }
      return false;
    }
    return ts.forEachChild(node, child => setsState(child, seen) || undefined) ?? false;
  };
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "setInterval" && node.arguments[0]) {
      const callback = node.arguments[0];
      if (reaches(callback, new Set()) || (fileFetches && setsState(callback, new Set()))) {
        lines.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

describe("a poll waits for its last read", () => {
  it("never polls the network on a fixed setInterval in hooks or components", () => {
    // A fixed interval keeps firing however long the read takes. Pedidos'
    // phone poll ran every 5 s; when the database slowed past that, a request
    // was always in flight, the page never went quiet, and the layout gate
    // timed it out on whichever role and width it happened to visit. A poll
    // schedules its next read after the last one settles (pollAfterSettle),
    // or uses SWR's refreshInterval, which already does.
    //
    // The older exceptions now follow the same rule; none may keep a fixed tick.
    const files = [...walk("src/hooks"), ...walk("src/components")];
    const offenders = files.flatMap(f => intervalFetches(f).map(line => `${f}:${line}`));
    expect(offenders, `use pollAfterSettle, or SWR:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("detects the shape it bans", () => {
    // A rule that matches nothing reports success. The old floor poll must trip it.
    const oldFloorPoll = "async function read() { await membershipRead('/x'); }\nconst t = setInterval(read, 5000);\n";
    expect(intervalFetches("poll.ts", oldFloorPoll)).toEqual([2]);
    expect(intervalFetches("clock.ts", "const t = setInterval(() => setNow(Date.now()), 30_000);\n")).toEqual([]);
  });

  it("audit #648: detects a fixed tick that re-runs a fetching effect through state", () => {
    // SettleTableDialog's old shape: the interval only bumps `attempt`, and
    // the effect that lists `attempt` fetches.
    const settleDialog = [
      "useEffect(() => {",
      "  fetch('/api/table-bill').then(r => r.json()).then(setOrders);",
      "  const timer = setInterval(() => setAttempt(n => n + 1), SPLIT_POLL_MS);",
      "  return () => clearInterval(timer);",
      "}, [attempt]);",
    ].join("\n");
    expect(intervalFetches("dialog.tsx", settleDialog)).toEqual([3]);
    const bump = "function bump() { setAttempt(n => n + 1); }\nfetch('/x');\nconst t = setInterval(bump, 5000);\n";
    expect(intervalFetches("named.tsx", bump)).toEqual([3]);
    // A clock in a file that also fetches is still allowed.
    expect(intervalFetches("clock.tsx", "fetch('/x');\nconst t = setInterval(() => setNow(Date.now()), 30_000);\n")).toEqual([]);
  });

  it("audit #648: detects router.refresh on a fixed tick", () => {
    // useMenuFreshness's old shape: a full server render every 45 s.
    const menuFreshness = [
      "const router = useRouter();",
      "const refresh = () => { if (document.visibilityState === 'visible') router.refresh(); };",
      "const timer = setInterval(refresh, 45_000);",
    ].join("\n");
    expect(intervalFetches("fresh.ts", menuFreshness)).toEqual([3]);
    expect(intervalFetches("inline.ts", "const t = setInterval(() => router.refresh(), 45_000);\n")).toEqual([1]);
  });
});
