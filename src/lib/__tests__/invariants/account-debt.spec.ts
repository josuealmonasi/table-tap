import { expect, it } from "vitest";
import ts from "typescript";
import { read, walk, schema } from "./helpers";

/** Discover database chains, rather than maintain a list that a new reader can
 * escape. Statement history is deliberately a separate non-debt query. */
function debtQueries(source: string): string[] {
  const ast = ts.createSourceFile("reader.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const queries: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const text = node.getText(ast);
      if (/\.from\(["']orders["']\)/.test(text) && /\.eq\(["']paid["'],\s*false\)/.test(text)
        && /\.(?:eq|not)\(["']account_id["']/.test(text)) {
        queries.push(text); return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); return queries;
}
function validQuery(q: string): boolean {
  return /\.eq\(["']written_off["'],\s*false\)/.test(q)
    && /\.select\(["'][^"']*\btotal\b/.test(q)
    && !/previous_total|subtotal|order_adjustments/.test(q);
}
function sqlDebtQueries(sql: string): string[] {
  return sql.split(";").filter(q => /sum\((?:\w+\.)?total\)/i.test(q) && /\bfrom orders\b/i.test(q)
    && /\baccount_id\s*=\s*p_account\b|v_checkout.order_ids/.test(q) && /(?:paid\s*=\s*false|not paid)/.test(q));
}
const validSql = (q: string): boolean => /(?:written_off\s*=\s*false|not written_off)/.test(q)
  && !/sum\([^)]*(?:subtotal|previous_total)/.test(q);

it("every unpaid account debt query reads reduced total and excludes written-off orders", () => {
  const found = walk("src").flatMap(file => debtQueries(read(file)).map(q => ({ file, q })));
  expect(found.length).toBeGreaterThanOrEqual(3);
  expect(found.filter(({ q }) => !validQuery(q)).map(({ file }) => file)).toEqual([]);
  const sql = sqlDebtQueries(schema);
  expect(sql.length).toBeGreaterThanOrEqual(6);
  expect(sql.filter(q => !validSql(q))).toEqual([]);
});
it("sabotage: every discovered TS reader fails without written_off or with subtotal", () => {
  for (const q of walk("src").flatMap(file => debtQueries(read(file)))) {
    expect(validQuery(q.replace(/\.eq\(["']written_off["'],\s*false\)/g, ""))).toBe(false);
    expect(validQuery(q.replace(/\btotal\b/g, "subtotal"))).toBe(false);
  }
  const newReader = 'db.from("orders").select("total").eq("account_id", id).eq("paid", false)';
  expect(debtQueries(newReader).every(validQuery)).toBe(false);
});
it("sabotage: every SQL sum fails if written_off is removed", () => {
  for (const q of sqlDebtQueries(schema)) {
    expect(validSql(q.replace(/(?:written_off\s*=\s*false|not written_off)/g, "true"))).toBe(false);
    expect(validSql(q.replace(/sum\(total\)/g, "sum(subtotal)"))).toBe(false);
  }
});
it("collection and online payment still compare expected amounts inside the locked writers", () => {
  for (const name of ["account_settle_v2", "account_settle_currency_v1", "account_checkout_open_v2", "account_checkout_currency_v1"]) {
    const body = schema.split(`create or replace function public.${name}(`)[1].split("$$;")[0];
    expect(body).toContain("lock_restaurant_money(p_restaurant)");
    expect(body).toContain("abs(v_owed - p_expected)");
    expect(body).toContain("written_off = false");
    expect(body).toContain("sum(total)");
  }
});
