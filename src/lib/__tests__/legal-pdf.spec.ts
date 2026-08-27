import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { TERMS_VERSION } from "@/lib/legal";
import terms from "@/lib/legal/terms-es.json";
import privacy from "@/lib/legal/privacy-es.json";

/**
 * Los PDF dicen lo mismo que la página, y dicen su versión.
 *
 * El texto legal vive en el JSON y el PDF se arma aparte, con un script que
 * hay que acordarse de correr. Dos copias del mismo contrato es un contrato
 * que tarde o temprano dice dos cosas distintas — y la que la gente descarga y
 * guarda es justamente la que se queda vieja.
 *
 * Se lee el PDF que se publica, no uno construido aquí: lo que importa es lo
 * que hay en `public/legal`, que es el archivo que alguien se lleva.
 */
function pdfText(file: string): string {
  const buf = readFileSync(file);
  const raw = buf.toString("latin1");
  let streams = "";
  // pdfkit comprime cada flujo y anuncia su largo en el diccionario: con eso
  // se encuentran los límites sin necesidad de un lector de PDF completo.
  for (const m of raw.matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)) {
    const start = m.index + m[0].length;
    try {
      streams += inflateSync(buf.subarray(start, start + Number(m[1]))).toString("latin1");
    } catch {
      // Un flujo que no es texto (fuentes, metadatos) no estorba.
    }
  }
  // El texto va en hexadecimal dentro de los arreglos TJ.
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
      // El primer párrafo basta: si el PDF se armó del JSON viejo, cambia.
      const first = clause.paragraphs[0].replace(/\s+/g, " ").slice(0, 60);
      expect(text, `${file}: "${clause.title}" dice algo distinto al JSON`).toContain(first);
    }
  });
});
