// ============================================================================
// The diff and the import graph `pnpm gate` plans from: which files changed,
// what in them changed, and who imports them. See gate-plan.mjs for what is
// done with it.
// ============================================================================
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = "src";
const EXTS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"];

export function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Files that differ from where this branch left `base`, committed or not. */
export function changedFiles(base, committedOnly = false) {
  const from = git("merge-base", base, "HEAD");
  const diffed = git("diff", "--name-only", from, ...(committedOnly ? ["HEAD"] : [])).split("\n");
  const untracked = committedOnly ? [] : git("ls-files", "--others", "--exclude-standard").split("\n");
  return [...new Set([...diffed, ...untracked])].filter(Boolean);
}

/**
 * Both sides of one file's change: the text before and after, and the lines
 * the diff touched on each side. A deleted line exists only in the old text,
 * so it is only found there.
 */
export function sides(base, file, committedOnly = false) {
  const from = git("merge-base", base, "HEAD");
  const show = ref => { try { return git("show", `${ref}:${file}`); } catch { return null; } };
  const oldText = show(from);
  const newText = committedOnly ? show("HEAD") : fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const diff = git("diff", "-U0", from, ...(committedOnly ? ["HEAD"] : []), "--", file);
  const oldLines = new Set();
  const newLines = new Set();
  for (const m of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [o, oc, n, nc] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    for (let l = o; l < o + oc; l++) oldLines.add(l);
    for (let l = n; l < n + nc; l++) newLines.add(l);
  }
  return { oldText, newText, oldLines, newLines };
}

export function walk(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "__stories__" && e.name !== "node_modules") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(path.normalize(p));
  }
  return out;
}

function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.join(path.dirname(from), spec);
  else return null;
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.normalize(candidate);
  }
  return null;
}

/**
 * Who imports each file, across src/, and what they take from it: the names
 * of a named import, or "*" for a namespace, a default, a side-effect or a
 * dynamic import — anything that is not a list of names counts as all of it.
 */
export function importers() {
  const users = new Map();
  const add = (target, user, names) => {
    if (!target) return;
    if (!users.has(target)) users.set(target, new Map());
    const edges = users.get(target);
    const had = edges.get(user);
    if (had === "*" || names === "*") edges.set(user, "*");
    else edges.set(user, new Set([...(had ?? []), ...names]));
  };
  for (const file of walk()) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        let names = "*";
        if (ts.isImportDeclaration(node)) {
          const clause = node.importClause;
          const bindings = clause?.namedBindings;
          if (clause && !clause.name && bindings && ts.isNamedImports(bindings)) {
            names = bindings.elements.map(e => (e.propertyName ?? e.name).text);
          }
        } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          names = node.exportClause.elements.map(e => (e.propertyName ?? e.name).text);
        }
        add(resolveImport(file, node.moduleSpecifier.text), file, names);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) add(resolveImport(file, arg.text), file, "*");
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return users;
}

/**
 * The exported names touched lines fall in, or "*" when one falls in
 * something every export may lean on — a private helper, an import, a type,
 * or a line between statements that is not blank.
 */
function exportsTouched(file, text, lines) {
  const source = text.split("\n");
  const touched = new Set([...lines].filter(l => (source[l - 1] ?? "").trim() !== ""));
  if (!touched.size) return new Set();
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lineOf = pos => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const names = new Set();
  const covered = new Set();
  let prevTo = 0;
  for (const stmt of sf.statements) {
    // The comments and blank lines above a statement belong to it.
    const from = prevTo + 1;
    const to = lineOf(stmt.getEnd());
    prevTo = to;
    const hit = [...touched].filter(l => l >= from && l <= to);
    if (!hit.length) continue;
    hit.forEach(l => covered.add(l));
    if (!stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) return "*";
    if (stmt.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) names.add("default");
    if (stmt.name && ts.isIdentifier(stmt.name)) names.add(stmt.name.text);
    if (ts.isVariableStatement(stmt)) for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
  }
  // Past the last statement: only trailing comments, which carry nothing.
  for (const l of touched) if (!covered.has(l) && !/^\s*(\/\/|\/?\*)/.test(source[l - 1])) return "*";
  return names;
}

/** The exported names a change touched in one file — on either side of it — or "*". */
export function changedExports(base, file, committedOnly = false) {
  const { oldText, newText, oldLines, newLines } = sides(base, file, committedOnly);
  if (oldText === null || newText === null) return "*";
  const before = exportsTouched(file, oldText, oldLines);
  const after = exportsTouched(file, newText, newLines);
  if (before === "*" || after === "*") return "*";
  return new Set([...before, ...after]);
}

/**
 * Every file that reaches a changed one, the changed ones included.
 *
 * The first step out of a changed file follows only the importers that take
 * a name the change touched; past that every importer counts, because an
 * affected file's own exports are not worth guessing at.
 *
 * @param {Iterable<string>} changed
 * @param {Map<string, Map<string, Set<string> | "*">>} users
 * @param {(file: string) => Set<string> | "*"} [exportsOf]
 * @returns {Set<string>}
 */
export function reach(changed, users, exportsOf = () => "*") {
  const seen = new Set(changed);
  const queue = [...changed].map(f => [f, exportsOf(f)]);
  while (queue.length) {
    const [file, names] = queue.shift();
    for (const [user, takes] of users.get(file) ?? []) {
      if (seen.has(user)) continue;
      const affected = names === "*" || takes === "*" || [...takes].some(n => names.has(n));
      if (!affected) continue;
      seen.add(user);
      queue.push([user, "*"]);
    }
  }
  return seen;
}

/**
 * The keys whose copy the touched lines sit in. Only leaves count: a
 * namespace's own braces carry no copy, and its changed lines are in leaves.
 */
function keysAt(file, text, touched) {
  const keys = new Set();
  if (!text || !touched.size) return keys;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lineOf = pos => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const visit = node => {
    const leaf = ts.isPropertyAssignment(node) && !ts.isObjectLiteralExpression(node.initializer);
    if (leaf && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) {
      const [from, to] = [lineOf(node.getStart(sf)), lineOf(node.getEnd())];
      for (const l of touched) if (l >= from && l <= to) keys.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return keys;
}

/**
 * The i18n files are imported by everything, so a copy change would reach
 * every screen. It reaches the files that use the keys that changed instead:
 * a key's name, quoted after its namespace, is how every caller spells it. A
 * key nobody spells that way is looked up by a built name (`plans.${id}`),
 * and that is "*": nothing here can say which screen shows it.
 */
export function keyUsers(base, files, committedOnly = false) {
  const keys = new Set();
  for (const f of files.filter(f => /^src\/lib\/i18n\/(es|en)\.ts$/.test(f))) {
    const { oldText, newText, oldLines, newLines } = sides(base, f, committedOnly);
    for (const k of [...keysAt(f, oldText, oldLines), ...keysAt(f, newText, newLines)]) keys.add(k);
  }
  const texts = walk().filter(f => !/^src\/lib\/i18n\//.test(f)).map(f => [f, fs.readFileSync(f, "utf8")]);
  const users = new Set();
  for (const k of keys) {
    const hits = texts.filter(([, text]) => text.includes(`.${k}"`) || text.includes(`.${k}\``) || text.includes(`.${k}'`));
    if (!hits.length) return "*";
    hits.forEach(([f]) => users.add(f));
  }
  return [...users];
}
