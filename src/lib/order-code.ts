/**
 * Finding an order by the code printed on its ticket.
 *
 * `orderCode` is the first four hex characters of the order's id, so a code is
 * a *prefix* of the primary key — and a prefix search on a uuid is a range
 * between the lowest and highest id that starts with it. That runs on the
 * primary key index, and it stays exact: no casting the column to text, no
 * scanning every order the restaurant has ever served.
 */

const HEX = /^[0-9a-f]{1,8}$/;

/** The half of a uuid string a code can pin down, padded into a full one. */
function pad(hex: string, fill: string): string {
  const full = (hex + fill.repeat(32)).slice(0, 32);
  return [
    full.slice(0, 8),
    full.slice(8, 12),
    full.slice(12, 16),
    full.slice(16, 20),
    full.slice(20, 32),
  ].join("-");
}

/**
 * The id range an order code covers, or null when the text isn't one.
 *
 * Accepts what somebody actually types off a ticket: `ORD-1960`, `ord1960`,
 * or just `1960`. Anything else — a table name, a dish — is not a code, and
 * the caller searches for it another way.
 */
export function orderCodeRange(query: string): { from: string; to: string } | null {
  const text = query.trim().toLowerCase();
  const labelled = /^ord[\s-]*/.test(text);
  const hex = text.replace(/^ord[\s-]*/, "").replace(/-/g, "");
  if (!HEX.test(hex)) return null;
  // A bare "6" is a table far more often than the start of a code, and codes
  // are printed four characters long — so a short query only counts as one
  // when it is spelled out with the prefix. Without this, searching for table
  // 6 returned every order whose id happens to begin with a six.
  if (!labelled && hex.length < 4) return null;
  return { from: pad(hex, "0"), to: pad(hex, "f") };
}

/**
 * What somebody means when they type a table.
 *
 * Labels are stored as the restaurant wrote them — "6", "Patio 3" — but the
 * word in front of the number is how everyone says it out loud, and the search
 * box invites it. Without this, "Mesa 6" found nothing at table 6.
 */
export function tableLabelQuery(query: string): string {
  return query.trim().replace(/^(mesa|table)\s+/i, "");
}
