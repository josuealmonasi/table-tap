/**
 * The specifics on a log line, written once and read in either language.
 *
 * The server records an event while nobody is reading it, so it cannot know
 * whether the answer will be read in Spanish or English. It writes the facts
 * as labelled fields — `table=4 orders=2 amount=120 method=cash` — and this
 * turns them into a sentence at the moment somebody looks. Before this, rows
 * in a Spanish dashboard said "1 order(s) · cash".
 *
 * Anything that doesn't parse is shown as it was written: an old row, or one
 * from a route that hasn't been converted, is still worth reading.
 */

export interface LogFields {
  [key: string]: string;
}

/** `table=4 amount=120` → { table: "4", amount: "120" } */
export function parseLogDetail(detail: string | null): LogFields | null {
  if (!detail || !detail.includes("=")) return null;
  const fields: LogFields = {};
  for (const part of detail.split(" ")) {
    const at = part.indexOf("=");
    if (at > 0) fields[part.slice(0, at)] = part.slice(at + 1).replaceAll("_", " ");
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

/** Writes the fields back out, for the server side. */
export function logDetail(fields: Record<string, string | number | null | undefined>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${String(v).replaceAll(" ", "_")}`)
    .join(" ");
}

/** Los tipos de cosa que la bitácora registra, en el orden en que se nombran. */
export const LOG_ENTITIES = [
  "staff",
  "order",
  "bill",
  "discount",
  "coupon",
  "promotion",
  "settings",
  "menu",
] as const;

/**
 * Qué tipos nombra lo que alguien escribió en el buscador.
 *
 * La columna guarda "settings" y la fila enseña "Ajustes": quien busca lo que
 * está viendo tiene que encontrarlo. Se compara sin acentos y sin mayúsculas
 * porque nadie escribe "Cupón" con su tilde en un buscador.
 */
export function entitiesNamedBy(
  query: string,
  label: (entity: string) => string,
): string[] {
  const needle = fold(query);
  if (!needle) return [];
  return LOG_ENTITIES.filter(entity => fold(label(entity)).includes(needle));
}

function fold(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
