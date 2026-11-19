import { expect, it } from "vitest";
import ts from "typescript";
import { read, walkAll } from "./helpers";

const payers = ["src/app/api/bill/pay/route.ts", "src/app/api/split/pay/route.ts",
  "src/app/api/account/pay/route.ts", "src/lib/split-slots-pay.ts"];

function violations(source: string): string[] {
  const file = ts.createSourceFile("payer.ts", source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function hasPercent(node: ts.Node): boolean {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "tipFromPercent") return false;
    return (ts.isIdentifier(node) && /pct|percent/i.test(node.text)) || Boolean(ts.forEachChild(node, hasPercent));
  }
  function visit(node: ts.Node): void {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if ((op === ts.SyntaxKind.AsteriskToken && (hasPercent(node.left) || hasPercent(node.right)))
        || (op === ts.SyntaxKind.SlashToken && node.right.getText(file) === "100" && hasPercent(node.left))) {
        found.push(node.getText(file));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

it("every percentage payer calls the shared helper and no pay route reimplements it", () => {
  for (const file of payers) expect(read(file), file).toMatch(/\btipFromPercent\s*\(/);
  const routes = walkAll("src/app/api").filter(f => f.endsWith("/pay/route.ts"));
  for (const file of new Set([...routes, ...payers])) expect(violations(read(file)), file).toEqual([]);
});

it.each(["const asked = payable * pct / 100;", "const tip = base * (tipPct / 100);",
  "const tip = (percentage / 100) * food;"])("catches a planted local percentage formula: %s", source => {
  const clean = "const tip = tipFromPercent(base, pct);";
  expect(violations(clean)).toEqual([]);
  expect(violations(`${clean}\n${source}`)).not.toEqual([]);
});
