import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
const source = readFileSync("scripts/probe-held-resolve.mjs", "utf8");
const ast = ts.createSourceFile("probe.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "refused")!;
// Execute the probe's actual helper against an ordered connection. A rejected
// query before SAVEPOINT aborts a real transaction before it can be recovered.
function helper(query: (sql: string) => Promise<void>) {
  return new Function("db", "assert", `${declaration.getText(ast)}; return refused;`)({ query }, assert) as
    (run: () => Promise<unknown>, message: RegExp) => Promise<void>;
}
it("establishes SAVEPOINT before invoking the refused-query thunk, then recovers", async () => {
  const events: string[] = [];
  const refused = helper(async sql => { events.push(sql); });
  await refused(async () => { events.push("write"); throw new Error("expected refusal"); }, /expected refusal/);
  expect(events).toEqual(["savepoint refused", "write", "rollback to savepoint refused", "release savepoint refused"]);
});
it.each(["unexpected success", "wrong error"])("rolls back and releases even after %s", async mode => {
  const queries: string[] = [];
  const refused = helper(async sql => { queries.push(sql); });
  await expect(refused(async () => { if (mode === "wrong error") throw new Error("unrelated"); }, /expected refusal/)).rejects.toThrow();
  expect(queries).toEqual(["savepoint refused", "rollback to savepoint refused", "release savepoint refused"]);
});
it("every refusal call passes a thunk rather than starting its write before SAVEPOINT", () => {
  let calls = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "refused") {
      calls++;
      expect(ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]), node.getText(ast)).toBe(true);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); expect(calls).toBeGreaterThan(0);
});
