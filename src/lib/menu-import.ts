/**
 * A menu read from a spreadsheet, checked line by line before anything is
 * written.
 *
 * Asked for by a café switching over: "import my menu and prices from a
 * spreadsheet". The first row names the columns — in Spanish or English,
 * with or without accents — and every row after it is a product. Only the
 * name and the price are required. Each line that cannot be imported says
 * why, and nothing is written until the owner has seen the list.
 *
 * Pure.
 */

export const MAX_IMPORT_PRICE = 100_000;
export const MAX_NAME = 120;
export const MAX_DESCRIPTION = 500;
/** What a product shows when the sheet gives it no emoji: the column default. */
export const DEFAULT_EMOJI = "🍽️";

/** A product ready to be written. `line` is its line in the sheet, from 1. */
export interface ImportRow {
  line: number;
  category: string | null;
  name: string;
  price: number;
  description: string;
  emoji: string;
}

export type ImportReason = "noName" | "badPrice" | "duplicate" | "exists" | "tooLong";

/** A line that will not be imported, and why. */
export interface ImportProblem {
  line: number;
  name: string;
  reason: ImportReason;
}

export interface ImportPlan {
  rows: ImportRow[];
  problems: ImportProblem[];
  /** The first row does not name a name column and a price column. */
  missingColumns: boolean;
}

type Column = "category" | "name" | "price" | "description" | "emoji";

/** What each column may be called, compared without case or accents. */
const NAMES: Record<Column, string[]> = {
  category: ["categoria", "category", "seccion", "section"],
  name: ["nombre", "name", "producto", "product", "platillo", "dish"],
  price: ["precio", "price"],
  description: ["descripcion", "description"],
  emoji: ["emoji", "icono", "icon"],
};

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Which column of the header row holds what. */
function columnsOf(header: string[]): Partial<Record<Column, number>> {
  const at: Partial<Record<Column, number>> = {};
  header.forEach((cell, i) => {
    const name = plain(cell);
    for (const [column, names] of Object.entries(NAMES) as [Column, string[]][]) {
      if (at[column] === undefined && names.includes(name)) at[column] = i;
    }
  });
  return at;
}

/**
 * A price as people type it: "35", "35.50", "$35", "1,250.00", and the
 * decimal comma Mexican Excel writes ("35,50"). A comma followed by one or two
 * digits at the end is a decimal point; any other comma separates thousands.
 */
export function readPrice(raw: string): number | null {
  let text = raw.replace(/[$\s]/g, "").replace(/mxn|usd/gi, "");
  if (!text) return null;
  if (text.includes(".") && text.includes(",")) text = text.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(",", ".");
  else text = text.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const price = Number(text);
  return Number.isFinite(price) && price <= MAX_IMPORT_PRICE ? Math.round(price * 100) / 100 : null;
}

/**
 * Turns a parsed sheet into the products to write and the lines refused.
 *
 * @param table      the sheet, header row first
 * @param existing   the names of the products the menu already has
 */
export function planImport(table: string[][], existing: string[]): ImportPlan {
  const [header = [], ...lines] = table;
  const at = columnsOf(header);
  if (at.name === undefined || at.price === undefined) return { rows: [], problems: [], missingColumns: true };

  const taken = new Set(existing.map(plain));
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  const cell = (line: string[], column: Column) => (at[column] === undefined ? "" : (line[at[column]!] ?? "").trim());

  lines.forEach((line, i) => {
    const number = i + 2; // the header is line 1
    const name = cell(line, "name");
    const refuse = (reason: ImportReason) => problems.push({ line: number, name, reason });
    if (!name) return refuse("noName");
    const description = cell(line, "description");
    if (name.length > MAX_NAME || description.length > MAX_DESCRIPTION) return refuse("tooLong");
    const price = readPrice(cell(line, "price"));
    if (price === null) return refuse("badPrice");
    const key = plain(name);
    if (taken.has(key)) return refuse("exists");
    if (seen.has(key)) return refuse("duplicate");
    seen.add(key);
    rows.push({
      line: number,
      category: cell(line, "category") || null,
      name,
      price,
      description,
      emoji: cell(line, "emoji") || DEFAULT_EMOJI,
    });
  });
  return { rows, problems, missingColumns: false };
}

/** The sections a plan needs, in the order they first appear. */
export function sectionsOf(rows: ImportRow[]): string[] {
  const names: string[] = [];
  for (const row of rows) {
    if (row.category && !names.some(n => plain(n) === plain(row.category!))) names.push(row.category);
  }
  return names;
}

/** Whether two section names are the same section ("Cafés" and "cafes"). */
export const sameSection = (a: string, b: string): boolean => plain(a) === plain(b);
