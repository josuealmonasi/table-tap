/**
 * A number as a person types it into a cash or quantity field, read the way
 * Mexico writes it: "1,250.50", "250.5", "18".
 *
 * A phone set to a decimal-comma region types "12,50" on its decimal keypad,
 * and Mexican Excel writes "35,50". A comma followed by one or two digits can
 * only be a decimal point, because thousands come in threes. Both parsers that
 * now call this deleted every comma instead, so a MX$12.50 withdrawal was
 * saved as MX$1,250 and a 0,5 l pack as 5 l.
 *
 * Null when it is not a number with at most `decimals` places, or when it
 * would have to be guessed (see `ambiguousDecimal`).
 */
export function typedDecimal(raw: unknown, decimals: number): number | null {
  const text = normalised(raw, decimals);
  if (text === null) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * "1,500" in a field that takes three decimals is 1.5 kg with a decimal comma
 * and 1,500 kg in Mexico. It is refused rather than guessed, with its own
 * message. Money has two decimals, so there it can only mean thousands.
 */
export function ambiguousDecimal(raw: unknown, decimals: number): boolean {
  return decimals >= 3 && typeof raw === "string" && /^[1-9]\d{0,2},\d{3}$/.test(raw.trim());
}

function normalised(raw: unknown, decimals: number): string | null {
  let text = typeof raw === "number" ? (Number.isFinite(raw) ? String(raw) : "")
    : typeof raw === "string" ? raw.trim() : "";
  if (ambiguousDecimal(text, decimals)) return null;
  if (/^\d+,\d{1,2}$/.test(text) || /^0,\d+$/.test(text)) text = text.replace(",", ".");
  else if (/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, "");
  const shape = decimals > 0 ? new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`) : /^\d+$/;
  return shape.test(text) ? text : null;
}
