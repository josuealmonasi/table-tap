import fs from "node:fs";
import PDFDocument from "pdfkit";

/**
 * Builds the PDFs the app links to, from the same JSON the pages render.
 *
 * A PDF because a legal document is something you keep: it downloads, it
 * prints, and it carries its version on every page. Built here rather than
 * rendered on request — the text only changes when the version does, so a file
 * on disk is both faster and one less thing that can fail while somebody is
 * trying to read what they agreed to.
 *
 * Run it whenever the terms change: `node scripts/legal-pdf.mjs`
 */
const VERSION = fs
  .readFileSync("src/lib/legal.ts", "utf8")
  .match(/TERMS_VERSION = "([^"]+)"/)[1];

const INK = "#16211C";
const MUTED = "#6E7A74";

function build(doc, { title, intro, clauses }) {
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(22).text(title);
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(10.5).fillColor(MUTED).text(intro, { width: 430 });
  doc.moveDown(1.2);

  for (const clause of clauses) {
    // Keep a heading with at least the start of its clause rather than alone
    // at the foot of a page.
    if (doc.y > 660) doc.addPage();
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(clause.title);
    doc.moveDown(0.3);
    for (const paragraph of clause.paragraphs) {
      doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(paragraph, {
        width: 430,
        align: "left",
        lineGap: 2,
      });
      doc.moveDown(0.45);
    }
    doc.moveDown(0.5);
  }

  doc.moveDown(1);
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Versión vigente: ${VERSION}`);
}

function write(sourceJson, out) {
  const data = JSON.parse(fs.readFileSync(sourceJson, "utf8"));
  const doc = new PDFDocument({ size: "LETTER", margins: { top: 64, bottom: 64, left: 64, right: 64 } });
  const stream = fs.createWriteStream(out);
  doc.pipe(stream);
  build(doc, data);
  doc.end();
  return new Promise(resolve => stream.on("finish", () => resolve(out)));
}

fs.mkdirSync("public/legal", { recursive: true });
const files = await Promise.all([
  write("src/lib/legal/terms-es.json", "public/legal/terminos.pdf"),
  write("src/lib/legal/privacy-es.json", "public/legal/aviso-de-privacidad.pdf"),
]);
for (const f of files) {
  console.log(`${f}  ${(fs.statSync(f).size / 1024).toFixed(1)} KB`);
}
