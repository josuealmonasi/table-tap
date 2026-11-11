import ts from "typescript";

const protectedColumn = /\b(account_id|charged_at|charged_by)\b/;
const mutation = /^(insert|upsert|update|delete)$/;

/** Inspect executable JS/SQL, ignoring comments and unrelated account readers. */
export function fixtureBypasses(source: string, dormantHistory = false): string[] {
  const file = ts.createSourceFile("fixture.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const failures = new Set<string>();
  const bindings = new Map<string, ts.Expression>();
  const bind = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer);
    ts.forEachChild(node, bind);
  };
  bind(file);
  const expanded = (node: ts.Node, seen = new Set<string>()): string => {
    if (ts.isIdentifier(node) && bindings.has(node.text) && !seen.has(node.text)) {
      return expanded(bindings.get(node.text)!, new Set([...seen, node.text]));
    }
    if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) {
      return node.getChildren(file).map(child => expanded(child, seen)).join(" ");
    }
    if (ts.isSpreadAssignment(node)) return expanded(node.expression, seen);
    if (node.kind === ts.SyntaxKind.SyntaxList) return node.getChildren(file).map(child => expanded(child, seen)).join(" ");
    return node.getText(file);
  };
  const fail = (node: ts.Node, reason: string): void => {
    failures.add(`${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${reason}`);
  };
  const visit = (node: ts.Node): void => {
    // The only exception imports pre-journal evidence; live fixtures cannot call it.
    if (dormantHistory && ts.isFunctionDeclaration(node) && node.name?.text === "dormantOrder") return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && mutation.test(node.expression.name.text)) {
      const table = /\.from\(\s*["'](orders|payments|order_adjustments)["']\s*\)/.exec(node.expression.expression.getText(file))?.[1];
      if (table) {
        let chain: ts.Node = node;
        while (ts.isPropertyAccessExpression(chain.parent) || ts.isCallExpression(chain.parent)) chain = chain.parent;
        const payload = node.arguments.map(arg => expanded(arg)).join(" ");
        const text = chain.getText(file), verb = node.expression.name.text;
        if (table === "orders" && protectedColumn.test(payload)) fail(node, "direct order charge");
        if (table === "order_adjustments") fail(node, "direct adjustment source");
        if (table === "payments" && (protectedColumn.test(payload)
          || /["']account_id["']/.test(text.replace(/\.is\(\s*["']account_id["']\s*,\s*null\s*\)/g, "")))) fail(node, "direct account receipt");
        if (table === "payments" && /^(update|delete)$/.test(verb)
          && !/\.is\(\s*["']account_id["']\s*,\s*null\s*\)/.test(text)) fail(node, "receipt mutation must exclude accounts");
        if (table === "orders" && verb === "delete" && /["']account_id["']/.test(text)) fail(node, "retained account source deletion");
      }
    }
    if (ts.isCallExpression(node) && node.expression.getText(file) === "bulkInsert") {
      const table = node.arguments[1], columns = node.arguments[2];
      if (table && columns && ts.isStringLiteral(table) && /^(orders|payments|order_adjustments)$/.test(table.text)
        && (table.text === "order_adjustments" || protectedColumn.test(expanded(columns)))) fail(node, "direct bulk account source");
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const sql = node.getText(file).replace(/--[^\n]*/g, "");
      if (/insert\s+into\s+(?:public\.)?orders\s*\([^)]*\b(account_id|charged_at|charged_by)\b/i.test(sql)
        || [...sql.matchAll(/update\s+(?:public\.)?orders\s+set\b([\s\S]*?)(?:\bwhere\b|\breturning\b|$)/gi)]
          .some(match => /\b(account_id|charged_at|charged_by)\s*=/i.test(match[1]))) fail(node, "direct SQL order charge");
      if (/insert\s+into\s+(?:public\.)?payments\s*\([^)]*\baccount_id\b/i.test(sql)) fail(node, "direct SQL account receipt");
      if (/(?:update\s+|delete\s+from\s+)(?:public\.)?payments\b/i.test(sql)
        && !/\baccount_id\s+is\s+null\b/i.test(sql)) fail(node, "SQL receipt mutation must exclude accounts");
      if (/(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?order_adjustments\b/i.test(sql)) fail(node, "direct SQL adjustment source");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...failures];
}
