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
 * The vocabulary is READ FROM THE APP'S OWN DICTIONARIES rather than written
 * out here. Three times a hand-written list was the thing that hid the next
 * batch: it had no word for "tarjeta", so `POST /api/checkout (tarjeta)` rode
 * through; no word for "encontró", so a thrown error did; and it was never
 * pointed at test titles at all, so four whole spec files were in Spanish —
 * `el precio de fundador`, `lo que el comensal puede hacer` — printed on every
 * run and read by nobody. `es.ts` is a thousand real Spanish words and grows
 * with the app; a list I think of does not.
 */
const words = (file: string): Set<string> => {
  const out = new Set<string>();
  for (const m of readFileSync(file, "utf8").matchAll(/:\s*"((?:\\.|[^"\\])*)"/g)) {
    for (const w of m[1].toLowerCase().match(/[a-záéíóúñü]+/g) ?? []) {
      if (w.length > 1) out.add(w);
    }
  }
  return out;
};

const ES = words("src/lib/i18n/es.ts");
const EN = words("src/lib/i18n/en.ts");
/** Words that belong to one language only — the ones that actually decide. */
const ES_ONLY = new Set([...ES].filter(w => !EN.has(w)));
const EN_ONLY = new Set([...EN].filter(w => !ES.has(w)));

/** How Spanish a piece of prose reads, against the app's own vocabulary. */
function readsSpanish(text: string, minimum = 2): boolean {
  const ws = text.toLowerCase().match(/[a-záéíóúñü]+/g) ?? [];
  let es = 0;
  let en = 0;
  for (const w of ws) {
    if (ES_ONLY.has(w)) es++;
    else if (EN_ONLY.has(w)) en++;
  }
  return es > en && es >= minimum;
}

// The Spanish that is allowed: what a customer or a restaurant actually reads.
// `legal-pdf.mjs` is on the list because it writes the Spanish legal documents —
// its strings ARE the copy — and `test-users.mjs` because `servicio` and
// `grupo` are plan identifiers the database stores, not words to anybody.
const SKIP = [
  "i18n/es.ts",
  "i18n/en.ts",
  "legal/",
  "node_modules",
  "scripts/legal-pdf.mjs",
  "scripts/test-users.mjs",
];

/** Where the sources are. `supabase` holds the schema, which is source too. */
const ROOTS = ["src", "scripts", "supabase"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (SKIP.some(s => path.includes(s))) continue;
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx|mjs|sql|css)$/.test(name)) out.push(path);
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
  // SQL says `--`. The schema is the most security-critical file in the repo
  // and no check had ever read a word of it, because the file list stopped at
  // .ts/.tsx/.mjs — so 23 blocks of reasoning about who may read which column
  // were written in Spanish with nothing to notice.
  const sql = line.match(/^\s*--+\s?(.*)$/);
  if (sql) return sql[1].trim();

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

/**
 * The comments in a file that read as Spanish.
 *
 * `EN` and `ES` in capitals are the names of the two languages, not the
 * Spanish words *en* and *es* — without this, the comment above the language
 * switch ("Customer EN/ES language switch") scored two Spanish words and no
 * English ones, and the guard reported perfectly good English as Spanish.
 */
function spanishComments(path: string): string[] {
  return comments(readFileSync(path, "utf8"))
    .filter(raw => {
      return readsSpanish(raw.replace(/\b(EN|ES)\b/g, " "));
    })
    .map(raw => `${path}  ${raw.slice(0, 70)}`);
}

/**
 * The strings in a script that read as Spanish.
 *
 * The comment guard above reads comments and nothing else, so for months every
 * check printed its verdict in Spanish — `MAL`, `rebota de /dashboard`,
 * `comensal es · carrito` — and no test could see it. The terminal is where a
 * developer reads this app's reasoning; it is code output, so it is English.
 *
 * Two kinds of Spanish string are legitimate here and must not be flagged:
 * text that MATCHES the app's Spanish UI (a selector, a marker, an expected
 * phrase) and the seed content of a Mexican demo restaurant. Both are data
 * about a Spanish thing rather than words addressed to a developer, and both
 * are identifiable from the line: a matcher sits behind one of these keys.
 */
/**
 * A string is exempt when IT is the value of a matcher key — not when some
 * other string on the same line is.
 *
 * The line-wide version was too coarse and hid a real one: `expect: [200],
 * check: d => … || "no devolvió el id de la etiqueta"` was let through whole,
 * because `expect:` appeared on it. The status codes and the failure message
 * are not the same kind of string and must not share an exemption.
 */
// `plan: "servicio"` is a database enum, as much an identifier as a uuid.
const MATCHER_KEY = /\b(text|marker|expect|sections|es|en|body|label|labelEn|name|plan|role)\s*:\s*\{?\s*$/;
/** A `sections: { "Zona horaria": OWNER, "Pagos": OWNER }` — every key is UI text. */
const MATCHER_MAP = /\bsections\s*:\s*\{[^}]*$/;
const MATCHER_CALL = /(includes|hasText|getByText|eq|ilike)\s*\(\s*$/;

/** Seed content for the demo restaurant — Spanish because the diners are. */
const SEED = ["scripts/mock-data.mjs", "scripts/seed-"];

function spanishOutput(path: string): string[] {
  if (SEED.some(s => path.includes(s))) return [];
  const out: string[] = [];
  // Block comments are the other guard's territory, and a comment is allowed to
  // quote a Spanish UI string. Blank them out — keeping the newlines, so the
  // reported line numbers still point at the right place.
  const src = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, m =>
    m.replace(/[^\n]/g, " "),
  );
  src.split("\n").forEach((line, i) => {
    const code = line.slice(0, lineComment(line) ? line.indexOf("//") : undefined);
    for (const m of code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      // What sits immediately before this string decides whether it is data
      // about a Spanish thing or words written to a developer.
      const before = code.slice(0, m.index);
      if (MATCHER_KEY.test(before) || MATCHER_CALL.test(before)) continue;
      if (MATCHER_MAP.test(before)) continue;
      const text = m[2].replace(/\$\{[^}]*\}/g, " ").replace(/\b(EN|ES)\b/g, " ");
      // A locale code, a path or a selector is an identifier, not prose: "es-MX"
      // and "terms-es.json" are not Spanish sentences, they only contain "es".
      if (/^[a-z]{2}-[A-Z]{2}$/.test(m[2].trim()) || m[2].includes("/")) continue;
      if (text.trim().length < 4) continue;
      if (readsSpanish(text, 1)) out.push(`${path}:${i + 1}  ${m[2].slice(0, 60)}`);
    }
  });
  return out;
}

/**
 * Every `describe()` and `it()` title in the repo.
 *
 * A test title is output: it is printed on every run and it is how a failure
 * names itself. Nothing checked them, and four whole spec files had been in
 * Spanish the entire time — thirty titles, read out loud by the runner on
 * every single run, and invisible to a guard that only looked at comments and
 * at `scripts/`.
 */
function testTitles(path: string): string[] {
  const src = readFileSync(path, "utf8");
  return [
    ...src.matchAll(/\b(?:describe|it)(?:\.each(?:<[^>]*>)?\([^)]*\))?\s*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g),
  ].map(m => m[2]);
}

describe("the code is written in English", () => {
  it("reads a SQL comment", () => {
    expect(lineComment("-- una política que no existe")).toBe("una política que no existe");
    expect(lineComment("  -- indented too")).toBe("indented too");
  });

  it("reads a comment that does not open its line", () => {
    expect(lineComment("  return null; // el pedido ya no existe")).toBe("el pedido ya no existe");
    expect(lineComment('const u = "https://x.mx/a//b";')).toBe("");
    expect(lineComment("const s = '// not a comment';")).toBe("");
  });

  it("has no Spanish comments outside the translated copy", () => {
    const offenders = ROOTS.flatMap(r => sourceFiles(r)).flatMap(spanishComments);
    expect(
      offenders,
      `Spanish comments — the code is English, only i18n and legal copy are Spanish:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("prints its output in English", () => {
    const offenders = sourceFiles("scripts").flatMap(spanishOutput);
    expect(
      offenders,
      `Spanish in script output — the terminal is read by developers, so it is\nEnglish. Text that matches the app's Spanish UI belongs behind a matcher\nkey (text:, marker:, expect:, es:):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("names its own tests in English", () => {
    const specs = ROOTS.flatMap(r => sourceFiles(r)).filter(f => /\.spec\.tsx?$/.test(f));
    expect(specs.length, "the spec scan found nothing").toBeGreaterThan(20);

    const offenders = specs.flatMap(path =>
      testTitles(path)
        .filter(title => readsSpanish(title, 1))
        .map(title => `${path}  ${title.slice(0, 66)}`),
    );
    expect(
      offenders,
      `Spanish test titles — the runner prints these on every run:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
