// Formatting helpers shared across the app.

/** Format a number as currency, e.g. formatMoney(14.9, "USD") → "$14.90". */
export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}
