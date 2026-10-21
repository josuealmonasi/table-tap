/** Checkout and receipts use cents; zero- and three-decimal currencies cannot enter that arithmetic. */
export function isDinerCurrency(value: unknown): value is "MXN" | "USD" {
  return value === "MXN" || value === "USD";
}

/** An old bill keeps its money even when the owner changes the menu currency. */
export function dinerCurrency(orders: { currency: string }[]): "MXN" | "USD" | null {
  const currency = orders[0]?.currency;
  return isDinerCurrency(currency) && orders.every(o => o.currency === currency) ? currency : null;
}
