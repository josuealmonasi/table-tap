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

/**
 * The platform's cut of an order, in the smallest currency unit (cents), taken
 * as an application fee on the destination charge. Set PLATFORM_FEE_BPS (basis
 * points, e.g. 250 = 2.5%) to enable it; defaults to 0 (no fee).
 */
export function platformFeeCents(totalCents: number): number {
  const bps = Number(process.env.PLATFORM_FEE_BPS) || 0;
  if (bps <= 0) return 0;
  return Math.round((totalCents * bps) / 10000);
}
