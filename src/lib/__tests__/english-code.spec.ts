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

/** Comment lines whose prose reads as Spanish rather than English. */
function spanishComments(path: string): string[] {
  const found: string[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const s = line.trim();
      if (!(s.startsWith("//") || s.startsWith("*") || s.startsWith("/*"))) return;
      const text = s.replace(/^(\/\/+|\/\*+|\*+\/?)/, "").replace(/\*\/\s*$/, "").trim();
      if (text.length < 12) return;
      const es = text.match(SPANISH)?.length ?? 0;
      const en = text.match(ENGLISH)?.length ?? 0;
      if (es > en && es >= 2) found.push(`${path}:${i + 1}  ${text.slice(0, 60)}`);
    });
  return found;
}

describe("the code is written in English", () => {
  it("has no Spanish comments outside the translated copy", () => {
    const offenders = [...sourceFiles("src"), ...sourceFiles("scripts")].flatMap(spanishComments);
    expect(
      offenders,
      `Spanish comments — the code is English, only i18n and legal copy are Spanish:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
