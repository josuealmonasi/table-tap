/** Match the adjustment's decimal cents: binary 1.005 rounds down in Math.round. */
export function receiptCents(value: number | string): number {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || String(value).length > 100) return NaN;
  const exponent = Number(match[4] ?? 0);
  if (Math.abs(exponent) > 100) return NaN;
  const point = match[2].length + exponent + 2;
  const digits = (match[2] + (match[3] ?? "")).padEnd(Math.max(point + 1, 0), "0");
  const rounded = (point > 0 ? Number(digits.slice(0, point)) : 0)
    + (point >= 0 && Number(digits[point]) >= 5 ? 1 : 0);
  const result = match[1] ? -rounded : rounded;
  return Number.isSafeInteger(result) ? result : NaN;
}
