import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The code is written in English.
 *
 * The only Spanish in this repo is text a customer or a restaurant actually
 * reads — `src/lib/i18n/es.ts` and `src/lib/legal/*`. Everything else, comments
 * included, is English, so anyone can read the reasoning without translating
 * it. Comments had drifted into Spanish across 87 files before anyone noticed.
 *
 * Scored rather than pattern-matched: a comment naming a Spanish UI string
 * ("the button says 'Agregar mesa'") is fine, and only prose that is mostly
 * Spanish gets flagged.
 */
const SPANISH =
  /\b(que|para|porque|cuando|desde|sólo|pero|este|esta|los|las|una|del|con|sin|más|así|hay|está|pedido|mesa|cuenta|comensal|platillo|dueño|gerente|mesero|cocina|pantalla|carrito|etiqueta|nada|todo|aquí|pagar|cobrar|guarda|enseña|se|le|lo|su|es|no|al|un|de|en|por|como|si)\b/gi;
const ENGLISH =
  /\b(the|and|of|to|is|for|that|with|this|it|as|are|be|not|which|when|from|but|only|so|because|what|who|how|they|their|has|have|we|you|its|there|then|than|into|on|at|by|an|a|or|if|no|all|one)\b/gi;

const SKIP = ["i18n/es.ts", "i18n/en.ts", "legal/", "node_modules"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (SKIP.some(s => path.includes(s))) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

/**
 * The comment on one line, if it has one.
 *
 * A comment does not have to open the line: `return; // un 404 es un pedido
 * borrado` is one too, and the first version of this only looked at line
 * starts, so every trailing comment was invisible to it.
 *
 * A `//` inside a string is not a comment. URLs are the common case, so a
 * slash pair introduced by `:` is skipped, as is one sitting inside an odd
 * number of quotes. Both tests can only make this miss a comment, never
 * invent one — a guard that cries wolf gets switched off.
 */
function lineComment(line: string): string {
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] !== "/" || line[i + 1] !== "/") continue;
    if (line[i - 1] === ":" || line[i - 1] === "\\") continue;
    if ((line.slice(0, i).match(/(?<!\\)["'`]/g)?.length ?? 0) % 2) continue;
    return line.slice(i + 2).replace(/^\/+/, "").trim();
  }
  return "";
}

/**
 * Every comment in a file, as blocks of prose.
 *
 * Three forms, because the first version of this only knew two and quietly
 * missed 29 Spanish comments — every `{/* … *\/}` in the components, which is
 * where most of the reasoning in this codebase lives. Consecutive `//` lines
 * are joined so a sentence split across three of them is scored as a sentence.
 */
function comments(src: string): string[] {
  const out: string[] = [];
  const seen = new Set<number>();

  // JSX and block comments first, and remember where they were so the line
  // scanner does not read their innards a second time.
  for (const m of src.matchAll(/\{\s*\/\*([\s\S]*?)\*\/\s*\}|\/\*([\s\S]*?)\*\//g)) {
    const body = (m[1] ?? m[2] ?? "").replace(/^\s*\*+/gm, " ");
    out.push(body.replace(/\s+/g, " ").trim());
    const from = src.slice(0, m.index).split("\n").length;
    const to = from + m[0].split("\n").length - 1;
    for (let i = from; i <= to; i++) seen.add(i);
  }

  let run: string[] = [];
  src.split("\n").forEach((line, i) => {
    const text = seen.has(i + 1) ? "" : lineComment(line);
    if (text) run.push(text);
    else if (run.length) {
      out.push(run.join(" ").replace(/\s+/g, " ").trim());
      run = [];
    }
  });
  if (run.length) out.push(run.join(" ").replace(/\s+/g, " ").trim());

  return out.filter(t => t.length >= 15);
}

/** The comments in a file that read as Spanish. */
function spanishComments(path: string): string[] {
  return comments(readFileSync(path, "utf8"))
    .filter(text => {
      const es = text.match(SPANISH)?.length ?? 0;
      const en = text.match(ENGLISH)?.length ?? 0;
      return es > en && es >= 2;
    })
    .map(text => `${path}  ${text.slice(0, 70)}`);
}

describe("the code is written in English", () => {
  it("reads a comment that does not open its line", () => {
    expect(lineComment("  return null; // el pedido ya no existe")).toBe("el pedido ya no existe");
    expect(lineComment('const u = "https://x.mx/a//b";')).toBe("");
    expect(lineComment("const s = '// not a comment';")).toBe("");
  });

  it("has no Spanish comments outside the translated copy", () => {
    const offenders = [...sourceFiles("src"), ...sourceFiles("scripts")].flatMap(spanishComments);
    expect(
      offenders,
      `Spanish comments — the code is English, only i18n and legal copy are Spanish:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
