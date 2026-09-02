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
 * Rounding money, in one place.
 *
 * This rule was written out eleven times — in the pricing engine, the table
 * bill, the till, the corte, the promotions, the plan. All eleven agreed, so
 * nothing was wrong; but the rule deciding what a diner is charged lived in
 * eleven files with nothing keeping them in step, and every bug this app has
 * had was two places that had to agree with nothing checking that they did.
 *
 * Centavos, so two decimals. Multiplying before rounding beats `toFixed`,
 * which returns a string and rounds 2.675 down to 2.67 where this gives 2.68.
 * Neither escapes binary floating point — 1.005 comes out 1.00 either way,
 * because 1.005 * 100 is 100.49999999999999 — so this is the honest rule, not
 * an exact one. Prices are small and the sums are short, so it holds.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
