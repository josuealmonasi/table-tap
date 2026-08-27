import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { TERMS_VERSION } from "@/lib/legal";
import terms from "@/lib/legal/terms-es.json";
import privacy from "@/lib/legal/privacy-es.json";

/**
 * The PDFs say the same as the page, and say their version.
 *
 * The legal text lives in the JSON and the PDF is built separately, by a
 * script somebody has to remember to run. Two copies of the same contract is
 * a contract that sooner or later says two different things — and the one
 * people download and keep is precisely the one that goes stale.
 *
 * It reads the PDF that ships, not one built here: what matters is what is in
 * `public/legal`, which is the file somebody takes away.
 */
function pdfText(file: string): string {
  const buf = readFileSync(file);
  const raw = buf.toString("latin1");
  let streams = "";
  // pdfkit compresses each stream and announces its length in the dictionary:
  // that finds the boundaries without needing a full PDF reader.
  for (const m of raw.matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)) {
    const start = m.index + m[0].length;
    try {
      streams += inflateSync(buf.subarray(start, start + Number(m[1]))).toString("latin1");
    } catch {
      // A stream that is not text (fonts, metadata) does no harm.
    }
  }
  // The text sits in hex inside the TJ arrays.
  return [...streams.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map(hex => Buffer.from(hex[1], "hex").toString("latin1"))
    .join("");
}

const DOCS = [
  ["public/legal/terminos.pdf", terms],
  ["public/legal/aviso-de-privacidad.pdf", privacy],
] as const;

describe("el PDF legal no se queda atrás del texto", () => {
  it.each(DOCS.map(([file]) => file))("%s lleva la versión vigente", file => {
    expect(
      pdfText(file),
      `${file} no dice ${TERMS_VERSION} — corre \`node scripts/legal-pdf.mjs\``,
    ).toContain(TERMS_VERSION);
  });

  it.each(DOCS)("%s trae todas sus cláusulas", (file, doc) => {
    const text = pdfText(file).replace(/\s+/g, " ");
    for (const clause of doc.clauses) {
      expect(text, `${file} no trae "${clause.title}"`).toContain(clause.title);
    }
  });

  it.each(DOCS)("%s trae el texto de cada cláusula, no sólo el título", (file, doc) => {
    const text = pdfText(file).replace(/\s+/g, " ");
    for (const clause of doc.clauses) {
      // The first paragraph is enough: if the PDF was built from the old JSON, it changes.
      const first = clause.paragraphs[0].replace(/\s+/g, " ").slice(0, 60);
      expect(text, `${file}: "${clause.title}" dice algo distinto al JSON`).toContain(first);
    }
  });
});
