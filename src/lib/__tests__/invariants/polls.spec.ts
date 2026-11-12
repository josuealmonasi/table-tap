import { describe, expect, it } from "vitest";
import ts from "typescript";
import { walk, read } from "./helpers";

/** Calls that go over the network (the admission helpers wrap `fetch`). */
const NETWORK = new Set(["fetch", "membershipRead", "requestPhoneMembership"]);

/**
 * Whether a `setInterval` callback reaches the network, following calls to
 * functions declared in the same file (`read`, `() => void load()`, ...).
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
    if (ts.isIdentifier(node)) {
      if (NETWORK.has(node.text)) return true;
      const body = functions.get(node.text);
      if (body && !seen.has(node.text)) { seen.add(node.text); if (reaches(body, seen)) return true; }
      return false;
    }
    return ts.forEachChild(node, child => reaches(child, seen) || undefined) ?? false;
  };
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "setInterval"
      && node.arguments[0] && reaches(node.arguments[0], new Set())) {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1);
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
    // schedules its next read after the last one settles (a chained
    // setTimeout), or uses SWR's refreshInterval, which already does.
    //
    // These predate the rule. The list only shrinks: convert one, delete it.
    const GRANDFATHERED = [
      "src/hooks/useOfflineSales.ts",
      "src/hooks/useOnline.ts",
      "src/hooks/useOrderFinished.ts",
      "src/hooks/useSitting.ts",
      "src/hooks/useSlotReceiptOffer.ts",
      "src/hooks/useTableBill.ts",
      "src/hooks/useTableMembership.ts",
      "src/components/dashboard/TableCalculator.tsx",
      "src/components/customer/TrackerOverlay.tsx",
    ];
    const files = [...walk("src/hooks"), ...walk("src/components")];
    const offenders = files.flatMap(f => intervalFetches(f).map(line => `${f}:${line}`));
    const fresh = offenders.filter(o => !GRANDFATHERED.some(g => o.startsWith(`${g}:`)));
    expect(fresh, `chain the poll with setTimeout after it settles, or use SWR:\n${fresh.join("\n")}`).toEqual([]);
    const converted = GRANDFATHERED.filter(g => !offenders.some(o => o.startsWith(`${g}:`)));
    expect(converted, "no longer polls on an interval: remove it from GRANDFATHERED").toEqual([]);
  });

  it("detects the shape it bans", () => {
    // A rule that matches nothing reports success. The old floor poll must trip it.
    const oldFloorPoll = "async function read() { await membershipRead('/x'); }\nconst t = setInterval(read, 5000);\n";
    expect(intervalFetches("poll.ts", oldFloorPoll)).toEqual([2]);
    expect(intervalFetches("clock.ts", "const t = setInterval(() => setNow(Date.now()), 30_000);\n")).toEqual([]);
  });
});
