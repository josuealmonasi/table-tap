/**
 * A CSV file as rows of cells.
 *
 * What a spreadsheet saves when somebody picks "CSV": commas between cells,
 * quotes around a cell that holds a comma, a quote or a line break, a doubled
 * quote for a quote inside one. Excel on Windows starts the file with a byte
 * order mark and ends lines with CRLF; Excel set to Spanish separates cells
 * with semicolons, because the comma is the decimal point there. All of that
 * is read here, so an owner can save their menu from whatever they use.
 *
 * Pure. Blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const separator = guessSeparator(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

/** Semicolons when the first line has more of them than commas, else commas. */
function guessSeparator(text: string): "," | ";" {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  return count(";") > count(",") ? ";" : ",";
}

/** Rows of cells as CSV text: the reverse, for a template to download. */
export function toCsv(rows: string[][]): string {
  return rows
    .map(r => r.map(c => (/[",\n\r;]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}
