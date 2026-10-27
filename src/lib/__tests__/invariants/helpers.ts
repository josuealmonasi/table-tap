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
