import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { read, schema, sources } from "./helpers";

/**
 * Finds every place that creates an order, from the source alone.
 *
 * An order is created by a direct `.from("orders").insert/upsert`, or by an
 * RPC whose body inserts into `orders` (directly or through another function
 * that does). A route creates orders when anything it imports, however
 * deeply, does one of those. Nothing here reads a list: the lists live in
 * `order-paths.ts`, and the spec compares the two.
 */

export interface SqlFunction {
  name: string;
  body: string;
  line: number;
}

/** Every `create function` in schema.sql, in file order (a later one replaces an earlier one). */
export function sqlFunctions(text = schema): SqlFunction[] {
  const found: SqlFunction[] = [];
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\4\$/gi;
  for (const m of text.matchAll(re)) {
    found.push({ name: m[1], body: m[5], line: text.slice(0, m.index).split("\n").length });
  }
  return found;
}

/** The body of the last definition of a function, which is the one a fresh database runs. */
export function sqlBody(name: string, fns = sqlFunctions()): string {
  const last = fns.filter(f => f.name === name).at(-1);
  if (!last) throw new Error(`schema.sql defines no function ${name}`);
  return last.body;
}

const INSERTS_ORDERS = /insert\s+into\s+(?:public\.)?"?orders"?\s*\(/i;
const calls = (body: string, name: string) => new RegExp(`\\b${name}\\s*\\(`).test(body);

/** Functions that insert an order, directly or by calling one that does. */
export function orderCreatingSql(fns = sqlFunctions()): Map<string, string> {
  const why = new Map<string, string>();
  for (const f of fns) if (INSERTS_ORDERS.test(f.body)) why.set(f.name, "inserts into orders");
  for (let grew = true; grew;) {
    grew = false;
    for (const f of fns) {
      if (why.has(f.name)) continue;
      const callee = [...why.keys()].find(name => calls(f.body, name));
      if (callee) { why.set(f.name, `calls ${callee}`); grew = true; }
    }
  }
  return why;
}

/** Functions that write orders through dynamic SQL, which the scan above cannot follow. */
export function dynamicOrderWrites(fns = sqlFunctions()): string[] {
  return fns.filter(f => /execute[\s\S]{0,200}insert\s+into\s+[^;]*orders/i.test(f.body)).map(f => f.name);
}

const DIRECT_INSERT = /\.from\(\s*["'`]orders["'`]\s*\)\s*\.(?:insert|upsert)\s*\(/;

/**
 * Source files that create an order: a direct insert, or a string literal
 * naming an order-creating RPC. A literal rather than `.rpc("…")`, so a name
 * kept in a variable or a ternary is still found. Quotes only: backticks are
 * how comments mention a function.
 */
export function orderWriterFiles(sqlNames: Iterable<string>, files = sources): Map<string, string[]> {
  const names = [...sqlNames];
  const out = new Map<string, string[]>();
  for (const file of files) {
    const text = read(file);
    const what: string[] = [];
    if (DIRECT_INSERT.test(text)) what.push("orders.insert");
    for (const name of names) if (new RegExp(`["']${name}["']`).test(text)) what.push(name);
    if (what.length) out.set(file, what);
  }
  return out;
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join("src", spec.slice(2))
    : spec.startsWith(".") ? path.join(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** What a file imports at runtime: type-only imports are erased and cannot write anything. */
export function runtimeImports(file: string): string[] {
  const text = read(file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.importClause?.isTypeOnly) continue;
      const named = node.importClause?.namedBindings;
      const onlyTypes = !node.importClause?.name && named && ts.isNamedImports(named)
        && named.elements.length > 0 && named.elements.every(e => e.isTypeOnly);
      if (!onlyTypes) specs.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) specs.push(node.moduleSpecifier.text);
    }
  }
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
  return specs.map(s => resolve(file, s)).filter((f): f is string => f !== null);
}

/** The file and everything it reaches at runtime. */
export function importClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const next of runtimeImports(file)) visit(next);
  };
  visit(entry);
  return seen;
}

export const apiRoutes = (): string[] => sources.filter(f => /^src\/app\/api\/.*\/route\.ts$/.test(f)).sort();
