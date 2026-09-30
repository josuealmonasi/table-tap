/**
 * What a scanned code turns out to be.
 *
 * Two kinds are printed: the QR on a diner's tracker, which holds the staff
 * link for their bill (`…/dashboard/bills?order=<id>`), and the one glued to a
 * table, which holds the menu for that table (`…/r/<restaurant>/t/<table>`).
 *
 * A camera hands back whatever it read, which may be a poster, somebody's wifi
 * card, or another restaurant's code, so this is the one place that decides
 * whether a scan meant anything.
 *
 * Pure, so every shape of rubbish can be tested without a camera.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function orderIdFromScan(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  // A bare id, in case a code is ever printed without the link around it.
  if (UUID.test(text)) return text;

  try {
    const found = new URL(text).searchParams.get("order");
    return found && UUID.test(found) ? found : null;
  } catch {
    // Not a URL at all — a plain-text QR, a phone number, a poster.
    return null;
  }
}

/** A table, from the code stuck to it. */
export interface ScannedTable {
  restaurantId: string;
  tableId: string;
}

/**
 * The table inside a scanned code.
 *
 * For a waiter who has been shown to a table and does not know its name — the
 * one the app calls "Patio 3" may have nothing on it saying so. Scanning is
 * how they say "this table" without knowing what anyone calls it.
 *
 * The restaurant comes back with it and is checked by the caller: a code from
 * another venue decodes perfectly well, and pointing an order at their table
 * is exactly what must not happen quietly.
 */
export function tableFromScan(raw: string | null | undefined): ScannedTable | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  let path: string;
  try {
    path = new URL(text).pathname;
  } catch {
    // Not a URL at all — a plain-text QR, a phone number, a poster.
    return null;
  }

  // `/r/<restaurant>/t/<table>`, and nothing after it: a longer path is some
  // other page that happens to start the same way.
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[0] !== "r" || parts[2] !== "t") return null;
  if (!UUID.test(parts[1]) || !UUID.test(parts[3])) return null;
  return { restaurantId: parts[1], tableId: parts[3] };
}

/** Twelve Crockford base32 characters: the code of an account or a visit card. */
const CODE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

function pathOf(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/**
 * The account a scanned code names: its statement link, `…/cuenta/<code>`.
 * For the till, when a customer holds up their statement to pay it.
 */
export function accountCodeFromScan(raw: string | null | undefined): string | null {
  const url = pathOf((raw ?? "").trim());
  if (!url) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  return parts.length === 2 && parts[0] === "cuenta" && CODE.test(parts[1].toUpperCase())
    ? parts[1].toUpperCase()
    : null;
}

/**
 * Where the diner's own scan button takes them: an account's statement, a
 * visit card, or a table's menu — the codes TableTap prints — as a path in
 * THIS app. The host a code names is ignored on purpose: a sticker over a
 * table's QR could name any site, and the button must never be the thing that
 * sends a diner there.
 */
export function dinerPathFromScan(raw: string | null | undefined): string | null {
  const code = accountCodeFromScan(raw);
  if (code) return `/cuenta/${code}`;
  const url = pathOf((raw ?? "").trim());
  if (!url) return null;
  if (url.pathname === "/rewards") {
    const card = (url.searchParams.get("c") ?? "").toUpperCase();
    return CODE.test(card) ? `/rewards?c=${card}` : null;
  }
  const table = tableFromScan(raw);
  if (table) return `/r/${table.restaurantId}/t/${table.tableId}`;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 2 && parts[0] === "r" && UUID.test(parts[1])) return `/r/${parts[1]}`;
  return null;
}
