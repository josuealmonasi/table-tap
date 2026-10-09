// ============================================================================
// What a stylesheet change can reach.
//
// Almost every screen change touches globals.css, and the whole file reaching
// everything made a one-rule fix re-check every screen in four widths. So the
// changed lines are mapped to the rules they sit in, and each rule to the
// classes its selector names; the components that spell those classes are
// where the change shows, and the import graph takes it from there to pages.
//
// Anything that cannot be pinned to a class reaches everything: a token on
// :root, a bare element selector, a keyframe, a line outside every rule, or a
// class no source file spells literally (one built as `tt-btn--${kind}`).
// Over-reaching costs minutes; under-reaching ships a broken screen.
// ============================================================================
import fs from "node:fs";
import path from "node:path";

/** Comments become spaces, newlines kept, so line numbers still line up. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, " "));
}

/**
 * Every block in the sheet: its prelude (a selector, or an at-rule), the
 * lines it spans from the prelude's first line to its closing brace, and the
 * blocks it sits in.
 */
export function blocks(text) {
  const clean = stripComments(text);
  const out = [];
  const stack = [];
  let line = 1;
  let preludeAt = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "\n") line++;
    else if (ch === "{") {
      const raw = clean.slice(preludeAt, i);
      const lead = raw.length - raw.trimStart().length;
      const startLine = line - (raw.slice(lead).match(/\n/g)?.length ?? 0);
      const block = { prelude: raw.trim(), from: startLine, to: null, parents: [...stack] };
      out.push(block);
      stack.push(block);
      preludeAt = i + 1;
    } else if (ch === "}") {
      const block = stack.pop();
      if (block) block.to = line;
      preludeAt = i + 1;
    } else if (ch === ";") preludeAt = i + 1;
  }
  return out;
}

const CLASS = /\.(-?[_a-zA-Z][\w-]*)/g;

/**
 * The classes a set of changed lines styles, or "*" when one of them cannot
 * be pinned to a class.
 */
export function changedClasses(text, touched) {
  const all = blocks(text);
  const clean = stripComments(text).split("\n");
  const classes = new Set();
  const styleRule = b => !b.prelude.startsWith("@") && !b.parents.some(p => /^@keyframes/.test(p.prelude));
  const take = rule => {
    const selectors = rule.prelude.split(",").map(sel => [...sel.matchAll(CLASS)].map(m => m[1]));
    // `.a, h2` styles every h2: one selector in the list without a class is enough.
    if (selectors.some(names => !names.length)) return false;
    selectors.flat().forEach(n => classes.add(n));
    return true;
  };
  for (const l of touched) {
    if ((clean[l - 1] ?? "").trim() === "") continue;
    const around = all.filter(b => b.from <= l && b.to !== null && l <= b.to);
    const innermost = around.at(-1);
    if (!innermost) return "*";
    if (styleRule(innermost)) {
      if (!take(innermost)) return "*";
      continue;
    }
    // An at-rule's own line — a breakpoint moved — restyles every rule inside it.
    if (/^@(media|supports|container)/.test(innermost.prelude) && l === innermost.from) {
      const inside = all.filter(b => b.parents.includes(innermost) && styleRule(b));
      if (!inside.length || !inside.every(take)) return "*";
      continue;
    }
    return "*";
  }
  return classes;
}

/**
 * The source files that spell any of these classes, or "*" when a class is
 * spelled by none of them — it is built at runtime, so nothing here can say
 * where it lands.
 */
export function classUsers(classes, files) {
  const texts = files.map(f => [f, fs.readFileSync(f, "utf8")]);
  const users = new Set();
  for (const name of classes) {
    const word = new RegExp(`(^|[^\\w-])${name.replace(/[-]/g, "\\-")}($|[^\\w-])`);
    const hits = texts.filter(([, text]) => word.test(text)).map(([f]) => path.normalize(f));
    if (!hits.length) return "*";
    hits.forEach(h => users.add(h));
  }
  return users;
}
