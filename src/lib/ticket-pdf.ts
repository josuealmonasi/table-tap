// ============================================================================
// The customer's ticket as a PDF shaped like thermal paper: 80 mm wide,
// centred header, a dashed rule between parts (owner's request, 2026-11-11),
// set in Archivo, the app's own typeface (ticket-fonts.ts). It prints what the SAT asks of a simplified receipt when the
// owner has filled it in — the business name, RFC and regime, the issuing
// location's address — then the lines, the totals, the visit card's progress
// and a QR that opens this sale for the staff.
//
// SERVER-ONLY (pdfkit, qrcode). The amounts come from receiptModel, the same
// calculation as the email and the reprint, so the paper never disagrees.
// ============================================================================
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { formatMoney } from "@/lib/format";
import type { ReceiptModel } from "@/lib/receipt";
import { printable as printText, ticketFace } from "@/lib/ticket-fonts";

/** 80 mm in points. */
export const TICKET_WIDTH = 226.77;
const MARGIN = 12;
const WIDTH = TICKET_WIDTH - MARGIN * 2;
const FONT = 8;
const SMALL = 7;
/** Space between two columns of the lines table. */
const GUTTER = 7;
/** Narrower than this, the item's name gets the whole row and the amounts the next. */
const MIN_NAME = 70;

export interface TicketPlace {
  name: string;
  legalName?: string | null;
  rfc?: string | null;
  /** "601 General de Ley Personas Morales" — the code and its name. */
  regime?: string | null;
  /** Already joined: street and number, neighbourhood and postal code, municipality and state. */
  addressLines?: string[];
  phone?: string | null;
  /** PNG or JPEG bytes of the restaurant's logo, when it has one. */
  logo?: Buffer | null;
  /** The owner's typeface (ticket-font-ids.ts); Archivo when unset. */
  font?: string | null;
}

export interface TicketLoyalty {
  /** The card's code's last four, never the whole code: a ticket identifies nobody. */
  last4: string;
  progress: number;
  goal: number;
  /** "Te faltan 3 para Postre gratis" or "¡Ganaste Postre gratis!" — already worded. */
  message: string;
}

export interface TicketText {
  folio: string;
  table: (label: string) => string;
  header: { qty: string; item: string; price: string; amount: string };
  articles: (n: number) => string;
  payMethod: (method: string) => string;
  loyaltyTitle: string;
  loyaltyLine: (t: TicketLoyalty) => string;
  qrHint: string;
  thanks: string;
  notFiscal: string;
}

/** Words to lines no wider than `max`, by the font's own measure; a word longer than a line is cut. */
export function wrapToWidth(text: string, max: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= max) { line = next; continue; }
    if (line) out.push(line);
    line = "";
    let piece = "";
    for (const ch of word) {
      if (measure(piece + ch) > max && piece) { out.push(piece); piece = ""; }
      piece += ch;
    }
    line = piece;
  }
  if (line) out.push(line);
  return out;
}

export interface Columns { qty: number; unit: number; amount: number; name: number; ownLine: boolean }

/**
 * The lines table's columns, as wide as what this ticket actually prints, so a
 * MX$10,000 line never runs into its neighbour. When that leaves the name too
 * little room, the amounts go on a row of their own under it.
 */
export function planColumns(model: ReceiptModel, header: TicketText["header"], measure: (s: string) => number): Columns {
  const money = (n: number) => formatMoney(n, model.cur);
  const widest = (values: string[]) => Math.max(0, ...values.map(measure));
  const qty = widest([header.qty, ...model.lines.map(l => (l.qty === null ? "" : String(l.qty)))]);
  const unit = widest([header.price, ...model.lines.map(l => (l.unit === null ? "" : money(l.unit)))]);
  const amount = widest([header.amount, ...model.lines.map(l => money(l.amount))]);
  const name = WIDTH - qty - unit - amount - GUTTER * 3;
  return name >= MIN_NAME ? { qty, unit, amount, name, ownLine: false }
    : { qty, unit, amount, name: WIDTH - qty - GUTTER, ownLine: true };
}

async function draw(doc: PDFKit.PDFDocument, model: ReceiptModel, place: TicketPlace, text: TicketText,
  loyalty: TicketLoyalty | null, qrUrl: string, font: unknown): Promise<void> {
  const face = ticketFace(font ?? place.font);
  const fonts = face;
  const printable = (s: string) => printText(s, face.latin1Only);
  const money = (n: number) => formatMoney(n, model.cur);
  const setFont = (bold: boolean, size: number) => doc.font(bold ? fonts.bold : fonts.regular).fontSize(size);
  const lead = (size: number) => size * 1.32;
  const center = (s: string, size = SMALL, bold = false) => {
    setFont(bold, size);
    for (const line of wrapToWidth(printable(s), WIDTH, t => doc.widthOfString(t))) {
      const y = doc.y;
      doc.text(line, MARGIN, y, { width: WIDTH, align: "center", lineBreak: false });
      doc.y = y + lead(size);
    }
  };
  /** One row: text on the left, text on the right, on the same baseline. */
  const row = (leftText: string, rightText: string, size = FONT, bold = false, rightBold = bold) => {
    const y = doc.y;
    setFont(bold, size).text(printable(leftText), MARGIN, y, { width: WIDTH, lineBreak: false });
    setFont(rightBold, size).text(printable(rightText), MARGIN, y, { width: WIDTH, align: "right", lineBreak: false });
    doc.y = y + lead(size);
  };
  const at = (s: string, x: number, width: number, align: "left" | "right", y: number) =>
    doc.text(printable(s), x, y, { width, align, lineBreak: false });
  const rule = (dashed = true) => {
    const y = doc.y + 3;
    doc.save().moveTo(MARGIN, y).lineTo(TICKET_WIDTH - MARGIN, y).lineWidth(0.6);
    if (dashed) doc.dash(2, { space: 2 });
    doc.stroke().restore();
    doc.y = y + 5;
  };
  const gap = (pt = 5) => { doc.y += pt; };

  doc.y = MARGIN;
  if (place.logo) {
    try { doc.image(place.logo, (TICKET_WIDTH - 56) / 2, doc.y, { fit: [56, 56], align: "center" }); doc.y += 60; } catch { /* not an image pdfkit reads: no logo */ }
  }
  center(place.name, 14, true);
  gap(2);
  if (place.legalName) center(place.legalName);
  for (const line of place.addressLines ?? []) center(line);
  if (place.phone) center(place.phone);
  if (place.rfc) center(`RFC ${place.rfc}`);
  if (place.regime) center(place.regime);
  gap(4);
  rule();
  row(text.folio, model.code, FONT, false, true);
  row(model.tableLabel ? text.table(model.tableLabel) : "", model.when, SMALL);
  rule();

  // The lines table: quantity, item, unit price, amount.
  setFont(true, 6.5);
  const cols = planColumns(model, text.header, t => setFont(false, FONT).widthOfString(t));
  const xName = MARGIN + cols.qty + GUTTER;
  const xAmount = MARGIN + WIDTH - cols.amount;
  const xUnit = xAmount - GUTTER - cols.unit;
  let y = doc.y;
  setFont(true, 6.5);
  at(text.header.qty, MARGIN, cols.qty, "left", y);
  at(text.header.item, xName, cols.name, "left", y);
  at(text.header.price, xUnit, cols.unit, "right", y);
  at(text.header.amount, xAmount, cols.amount, "right", y);
  doc.y = y + lead(6.5) + 1;
  for (const l of model.lines) {
    setFont(false, FONT);
    const names = wrapToWidth(printable(l.name), cols.name, t => doc.widthOfString(t));
    y = doc.y;
    at(l.qty === null ? "" : String(l.qty), MARGIN, cols.qty, "left", y);
    names.forEach((n, i) => at(n, xName, cols.name, "left", y + i * lead(FONT)));
    const priceY = cols.ownLine ? y + names.length * lead(FONT) : y;
    if (l.unit !== null) at(money(l.unit), xUnit, cols.unit, "right", priceY);
    at(money(l.amount), xAmount, cols.amount, "right", priceY);
    doc.y = y + (names.length + (cols.ownLine ? 1 : 0)) * lead(FONT) + 1.5;
  }
  const articles = model.lines.reduce((n, l) => n + (l.qty ?? 0), 0);
  rule();
  if (articles) row(text.articles(articles), "", SMALL);
  for (const [label, amount] of model.rows) row(label, amount);
  gap(2);
  row(model.totalLabel.toUpperCase(), money(model.paid), 12, true);
  if (model.payMethod) row(text.payMethod(model.payMethod), "", SMALL);

  if (loyalty) {
    gap(6);
    const top = doc.y;
    doc.y += 7;
    center(text.loyaltyTitle, SMALL, true);
    gap(3);
    // The card itself: one circle per visit, the ones earned filled in.
    const perRow = Math.min(loyalty.goal, 10);
    const r = 5, step = 15;
    for (let i = 0; i < loyalty.goal; i++) {
      const cx = TICKET_WIDTH / 2 - ((perRow - 1) * step) / 2 + (i % perRow) * step;
      const cy = doc.y + r + Math.floor(i / perRow) * step;
      doc.save().lineWidth(0.8).circle(cx, cy, r);
      if (i < loyalty.progress) doc.fill("#000"); else doc.stroke();
      doc.restore();
    }
    doc.y += Math.ceil(loyalty.goal / perRow) * step + 2;
    center(text.loyaltyLine(loyalty), SMALL);
    center(loyalty.message, FONT, true);
    doc.y += 6;
    doc.save().roundedRect(MARGIN, top, WIDTH, doc.y - top, 6).lineWidth(0.6).stroke().restore();
  }
  gap(8);
  const qr = await QRCode.toBuffer(qrUrl, { errorCorrectionLevel: "M", margin: 0, width: 240 });
  doc.image(qr, (TICKET_WIDTH - 88) / 2, doc.y, { width: 88 });
  doc.y += 94;
  center(text.qrHint, 6.5);
  gap(6);
  center(text.thanks, 9, true);
  center(text.notFiscal, 6.5);
  doc.y += MARGIN;
}

/**
 * The ticket's PDF. Laid out twice: once on a tall page to learn how long the
 * paper is, then on a page exactly that long, as a thermal roll would cut it.
 */
export async function ticketPdf(model: ReceiptModel, place: TicketPlace, text: TicketText,
  loyalty: TicketLoyalty | null, qrUrl: string, font: unknown = undefined): Promise<Buffer> {
  const measure = new PDFDocument({ size: [TICKET_WIDTH, 5000], margin: 0 });
  await draw(measure, model, place, text, loyalty, qrUrl, font);
  const height = Math.ceil(measure.y);
  measure.end();
  const doc = new PDFDocument({ size: [TICKET_WIDTH, height], margin: 0, info: { Title: `${place.name} ${model.code}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(resolve => doc.on("end", () => resolve(Buffer.concat(chunks))));
  await draw(doc, model, place, text, loyalty, qrUrl, font);
  doc.end();
  return done;
}
