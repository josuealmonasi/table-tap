// Pure money math — no imports, no side effects, so it's easy to unit-test and
// reuse on both the customer and server sides.

/**
 * Splits an IVA-inclusive subtotal into its net + tax parts. Menu prices already
 * include IVA, so net = subtotal / (1 + rate) and iva = subtotal − net.
 * A rate of 0 (or less) means no tax: the whole amount is net.
 */
export function ivaSplit(subtotal: number, taxPct: number): { net: number; iva: number } {
  if (taxPct <= 0) return { net: subtotal, iva: 0 };
  const net = subtotal / (1 + taxPct / 100);
  return { net, iva: subtotal - net };
}
