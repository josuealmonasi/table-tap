/**
 * The order id inside a scanned code.
 *
 * The QR on a diner's tracker holds the staff link for their bill —
 * `…/dashboard/bills?order=<id>`. A camera hands back whatever it read, which
 * may be a poster, somebody's wifi card, or another restaurant's code, so this
 * is the one place that decides whether a scan meant anything.
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
