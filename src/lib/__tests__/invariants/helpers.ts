import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Rules that span more than one file, with nothing else to enforce them.
 *
 * Every bug these came from was the same shape: two places that had to agree,
 * and nothing checking that they did. A reviewer cannot hold that in their
 * head across a large change, and none of it shows up as a type error — the
 * code compiles perfectly while the staff screen says a table owes MX$105 and
 * the diner's screen says it owes nothing.
 *
 * Each test in this suite is a bug that actually shipped. Adding to the suite is the
 * cheapest thing to do after finding the next one.
 */

export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !full.includes("__tests__")) out.push(full);
  }
  return out;
}

/** Every file under a directory, whatever its name. */
export function walkAll(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAll(full, out);
    else out.push(full);
  }
  return out;
}

export const schema = fs.readFileSync("supabase/schema.sql", "utf8");
export const sources = walk("src");
export const read = (f: string) => fs.readFileSync(f, "utf8");

/** The source between an opening `(` and its match. */
export function callBody(src: string, from: number): string {
  let depth = 1;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(from, i);
  }
  return src.slice(from);
}

/** Follow the index's imports, so an unregistered part cannot cover a route. */
export function apiCaseFiles(): string[] {
  const files = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (!statement.moduleSpecifier.text.startsWith(".")) continue;
      const target = path.normalize(path.join(path.dirname(file), statement.moduleSpecifier.text));
      if (target.startsWith("scripts/api-cases/")) visit(target);
    }
  };
  visit("scripts/api-cases.mjs");
  return [...files];
}

export const listed = (file: string): string => file === "api-cases.mjs"
  ? apiCaseFiles().map(read).join("\n")
  : read(path.join("scripts", file));

/** Check registration as well as paths: two groups can exercise the same route. */
export function apiCaseRegistrationErrors(readSource = read): string[] {
  const files = ["scripts/api-cases.mjs", ...walkAll("scripts/api-cases").filter(f => f.endsWith(".mjs"))];
  const options = { allowJs: true, noResolve: true, noLib: true };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile;
  host.getSourceFile = (name, ...args) => files.includes(name)
    ? ts.createSourceFile(name, readSource(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    : original(name, ...args);
  const program = ts.createProgram(files, options, host);
  const checker = program.getTypeChecker();
  const imported = new Map<string, Set<string>>();
  const errors: string[] = [];
  const index = ts.createSourceFile(files[0], readSource(files[0]), ts.ScriptTarget.Latest, true);
  const assembly = index.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === "cases");
  const returned = assembly && ts.isFunctionDeclaration(assembly)
    ? assembly.body?.statements.find(ts.isReturnStatement)?.expression : undefined;
  const spread = new Set(returned && ts.isArrayLiteralExpression(returned)
    ? returned.elements.filter(ts.isSpreadElement).map(element => element.expression)
      .filter(ts.isCallExpression).map(call => call.expression.getText(index)) : []);

  for (const file of files) {
    const source = ts.createSourceFile(file, readSource(file), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const target = path.normalize(path.join(path.dirname(file), statement.moduleSpecifier.text));
      if (!target.startsWith("scripts/api-cases/")) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) {
        errors.push(`${file}: use named imports for ${target}`);
        continue;
      }
      const names = imported.get(target) ?? new Set<string>();
      imported.set(target, names);
      for (const binding of bindings.elements) {
        names.add((binding.propertyName ?? binding.name).text);
        if (file === files[0] && !spread.has(binding.name.text)) {
          errors.push(`${binding.name.text}: imported factory is not spread into cases`);
        }
      }
    }
  }
  for (const file of files.slice(1)) {
    // The checker includes variables, aliases and re-exports, not just functions.
    // Use the supplied source too, so sabotage tests need no writes to held parts.
    const source = program.getSourceFile(file)!;
    const symbol = checker.getSymbolAtLocation(source);
    const exports = symbol ? checker.getExportsOfModule(symbol) : [];
    if (!imported.has(file)) errors.push(`${file}: part is not imported`);
    for (const entry of exports) {
      if (!imported.get(file)?.has(entry.name)) errors.push(`${file}: export ${entry.name} is not imported`);
    }
  }
  return errors;
}
