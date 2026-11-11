// ============================================================================
// The customer's ticket as a PDF shaped like thermal paper: 80 mm wide,
// monospace, centred header, a dashed rule between parts (owner's request,
// 2026-11-11). It prints what the SAT asks of a simplified receipt when the
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

/** 80 mm in points. */
export const TICKET_WIDTH = 226.77;
const MARGIN = 10;
const WIDTH = TICKET_WIDTH - MARGIN * 2;
const FONT = 8;
const LINE = FONT * 1.35;
/** Courier is 0.6 em wide: the columns are counted in characters. */
const CHARS = Math.floor(WIDTH / (FONT * 0.6));

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

const pad = (left: string, right: string, width = CHARS) => {
  const room = width - right.length;
  return (left.length > room - 1 ? left.slice(0, Math.max(0, room - 1)) : left).padEnd(room) + right;
};

/** Wraps text to the ticket's width in characters, breaking on spaces. */
export function wrapTicket(text: string, width = CHARS): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > width) { if (line) out.push(line); for (let i = 0; i < word.length; i += width) out.push(word.slice(i, i + width)); line = ""; continue; }
    if ((line ? line.length + 1 : 0) + word.length > width) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** The sold lines in four columns: quantity, item, unit price, amount. */
export function lineRows(model: ReceiptModel): string[] {
  const money = (n: number) => formatMoney(n, model.cur);
  const rows: string[] = [];
  const numbers = 22; // room for "  MX$1,234.00  MX$12,345.00"
  for (const l of model.lines) {
    const qty = l.qty === null ? "" : String(l.qty);
    const right = `${l.unit === null ? "" : money(l.unit)} ${money(l.amount)}`.padStart(numbers);
    const nameWidth = CHARS - numbers - 4;
    const [first, ...more] = wrapTicket(l.name, nameWidth);
    rows.push(`${qty.padEnd(3)} ${(first ?? "").padEnd(nameWidth)}${right}`);
    for (const m of more) rows.push(`    ${m}`);
  }
  return rows;
}

async function draw(doc: PDFKit.PDFDocument, model: ReceiptModel, place: TicketPlace, text: TicketText,
  loyalty: TicketLoyalty | null, qrUrl: string): Promise<void> {
  const center = (s: string, size = FONT, bold = false) => {
    doc.font(bold ? "Courier-Bold" : "Courier").fontSize(size).text(s, MARGIN, doc.y, { width: WIDTH, align: "center" });
  };
  // One line exactly: pdfkit moves the cursor by its own measure, so the
  // next line's place is set here, not left to it (the rows printed double-spaced).
  const left = (s: string, bold = false, size = FONT) => {
    const y = doc.y;
    doc.font(bold ? "Courier-Bold" : "Courier").fontSize(size).text(s, MARGIN, y, { width: WIDTH, lineBreak: false });
    doc.y = y + size * 1.35;
  };
  const rule = (ch = "-") => left(ch.repeat(CHARS));
  const gap = (n = 0.5) => { doc.y += LINE * n; };

  doc.y = MARGIN;
  if (place.logo) {
    try { doc.image(place.logo, (TICKET_WIDTH - 60) / 2, doc.y, { fit: [60, 60], align: "center" }); doc.y += 64; } catch { /* not an image pdfkit reads: no logo */ }
  }
  center(place.name.toUpperCase(), 12, true);
  gap(0.3);
  if (place.legalName) center(place.legalName);
  for (const line of place.addressLines ?? []) center(line);
  if (place.phone) center(place.phone);
  if (place.rfc) center(`RFC ${place.rfc}`);
  if (place.regime) for (const line of wrapTicket(place.regime)) center(line);
  gap();
  left(pad("", model.when));
  left(pad(text.folio, model.code));
  if (model.tableLabel) left(text.table(model.tableLabel));
  gap(0.5);
  left(pad(`${text.header.qty.padEnd(3)} ${text.header.item}`, `${text.header.price}  ${text.header.amount}`));
  rule("=");
  for (const row of lineRows(model)) left(row);
  gap(0.5);
  const articles = model.lines.reduce((n, l) => n + (l.qty ?? 0), 0);
  if (articles) left(text.articles(articles));
  gap(0.5);
  for (const [label, amount] of model.rows) left(pad(`${label}:`, amount));
  left(pad(`${model.totalLabel.toUpperCase()}:`, formatMoney(model.paid, model.cur), Math.floor(WIDTH / (11 * 0.6))), true, 11);
  if (model.payMethod) left(text.payMethod(model.payMethod));
  if (loyalty) {
    gap();
    rule();
    center(text.loyaltyTitle, FONT, true);
    for (const line of wrapTicket(text.loyaltyLine(loyalty))) center(line);
    for (const line of wrapTicket(loyalty.message)) center(line);
  }
  gap();
  rule();
  const qr = await QRCode.toBuffer(qrUrl, { errorCorrectionLevel: "M", margin: 0, width: 240 });
  doc.image(qr, (TICKET_WIDTH - 90) / 2, doc.y + 4, { width: 90 });
  doc.y += 98;
  for (const line of wrapTicket(text.qrHint)) center(line);
  gap();
  center(text.thanks.toUpperCase(), FONT, true);
  for (const line of wrapTicket(text.notFiscal)) center(line);
  doc.y += MARGIN;
}

/**
 * The ticket's PDF. Laid out twice: once on a tall page to learn how long the
 * paper is, then on a page exactly that long, as a thermal roll would cut it.
 */
export async function ticketPdf(model: ReceiptModel, place: TicketPlace, text: TicketText,
  loyalty: TicketLoyalty | null, qrUrl: string): Promise<Buffer> {
  const measure = new PDFDocument({ size: [TICKET_WIDTH, 5000], margin: 0 });
  await draw(measure, model, place, text, loyalty, qrUrl);
  const height = Math.ceil(measure.y);
  measure.end();
  const doc = new PDFDocument({ size: [TICKET_WIDTH, height], margin: 0, info: { Title: `${place.name} ${model.code}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(resolve => doc.on("end", () => resolve(Buffer.concat(chunks))));
  await draw(doc, model, place, text, loyalty, qrUrl);
  doc.end();
  return done;
}
