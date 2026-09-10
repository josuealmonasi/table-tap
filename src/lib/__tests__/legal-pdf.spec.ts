import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { TERMS_VERSION } from "@/lib/legal";
import terms from "@/lib/legal/terms-es.json";
import privacy from "@/lib/legal/privacy-es.json";

/**
 * The PDF says what the app says.
 *
 * The terms live in JSON, and the file people download is built from it by
 * `node scripts/legal-pdf.mjs`. Nothing made anyone run it: the text on the
 * screen could move while the signed-looking document in `public/` still said
 * last month's promise, and a contract that says two things is worse than one
 * nobody reads. This is the thing that makes somebody run it.
 */

/** Text drawn by the document, in the order it is drawn. */
function textOf(path: string): string {
  const pdf = readFileSync(path);
  const runs: string[] = [];
  // Every stream that inflates; the ones that do not are fonts and images.
  for (const match of pdf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let page: string;
    try {
      page = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
    } catch {
      continue;
    }
    // Glyphs are written as hex strings, broken up by kerning numbers.
    for (const hex of page.matchAll(/<([0-9a-fA-F]+)>/g)) {
      runs.push(Buffer.from(hex[1], "hex").toString("latin1"));
    }
  }
  return runs.join("");
}

/**
 * Back from what the page is encoded in to what the JSON is written in.
 *
 * The document is drawn in WinAnsi, where the em dash somebody typed into the
 * contract is one byte the JSON has never heard of.
 */
const TYPOGRAPHY: Record<string, string> = {
  "": "‘",
  "": "’",
  "": "“",
  "": "”",
  "": "–",
  "": "—",
  "": "…",
};

/** Whitespace is where the page wraps, and it wraps wherever it likes. */
function packed(text: string): string {
  return text
    .replace(/[-]/g, ch => TYPOGRAPHY[ch] ?? ch)
    .replace(/\s+/g, "");
}

describe("the legal PDFs say what the app says", () => {
  const documents = [
    ["public/legal/terminos.pdf", terms],
    ["public/legal/aviso-de-privacidad.pdf", privacy],
  ] as const;

  it("carries every paragraph of every clause", () => {
    for (const [path, doc] of documents) {
      const drawn = packed(textOf(path));
      for (const clause of doc.clauses) {
        expect(drawn, `${path}: the clause "${clause.title}" is not in the PDF`).toContain(
          packed(clause.title),
        );
        for (const paragraph of clause.paragraphs) {
          expect(
            drawn,
            `${path}: a paragraph of "${clause.title}" is not in the PDF — ` +
              `run \`node scripts/legal-pdf.mjs\`:\n  ${paragraph.slice(0, 70)}`,
          ).toContain(packed(paragraph));
        }
      }
    }
  });

  it("is the version the app is asking people to accept", () => {
    expect(
      packed(textOf("public/legal/terminos.pdf")),
      "the terms PDF was built before the version was bumped — rebuild it",
    ).toContain(TERMS_VERSION);
  });
});
