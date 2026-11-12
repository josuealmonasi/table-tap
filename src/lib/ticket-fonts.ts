// ============================================================================
// The ticket's typefaces (ticket-font-ids.ts lists them). Archivo and IBM Plex
// Mono are static Regular and Bold files under the OFL (fonts/OFL-*.txt):
// pdfkit cannot embed the variable Archivo that Google Fonts and next/font
// ship — it printed blank, then crashed in the subsetter — so the static
// files come from the designer's repository (Omnibus-Type/Archivo) and IBM's
// (IBM/plex). Courier is one of the PDF's own standard fonts: nothing embedded.
//
// SERVER-ONLY. Files are read from disk once; next.config traces them into
// the routes that print.
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TICKET_FONT, isTicketFont, type TicketFontId } from "@/lib/ticket-font-ids";

/** A font pdfkit takes: a standard font's name, or the bytes of a TrueType file. */
export interface TicketFace { regular: Buffer | string; bold: Buffer | string; latin1Only: boolean }

const FILES: Record<Exclude<TicketFontId, "classic">, [string, string]> = {
  archivo: ["Archivo-Regular.ttf", "Archivo-Bold.ttf"],
  plex: ["IBMPlexMono-Regular.ttf", "IBMPlexMono-Bold.ttf"],
};
const cache = new Map<TicketFontId, TicketFace>();

export function ticketFace(id: unknown): TicketFace {
  const font = isTicketFont(id) ? id : DEFAULT_TICKET_FONT;
  const hit = cache.get(font);
  if (hit) return hit;
  let face: TicketFace;
  if (font === "classic") face = { regular: "Courier", bold: "Courier-Bold", latin1Only: true };
  else {
    const dir = join(process.cwd(), "src/lib/fonts");
    const [regular, bold] = FILES[font];
    face = { regular: readFileSync(join(dir, regular)), bold: readFileSync(join(dir, bold)), latin1Only: false };
  }
  cache.set(font, face);
  return face;
}

/** Latin (ñ, á, ü and Latin Extended), the punctuation and currency blocks, and the minus sign. */
const EMBEDDED = /[^\u0020-\u024F\u2010-\u2027\u2030-\u205E\u20A0-\u20BF\u2212]/gu;

/**
 * What the face can draw. A dish named with an emoji would otherwise print an
 * empty box. Courier's table is Latin-1 (WinAnsi): ñ and á print there, but the
 * minus sign the receipt uses and curly quotes become their plain forms.
 */
export function printable(text: string, latin1Only = false): string {
  const plain = latin1Only
    ? text.replace(/\u2212|[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2022/g, "\u00B7").replace(/[^\u0020-\u00FF]/gu, "")
    : text.replace(EMBEDDED, "");
  return plain.replace(/ {2,}/g, " ").trim();
}
