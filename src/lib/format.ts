// Formatting helpers shared across the app.

/**
 * The locale every price is written in, pinned on purpose.
 *
 * With `undefined` the runtime chose it, so the same price came out as two
 * different strings: the server (en-US) wrote "MX$23.00" and a phone set to
 * es-MX wrote "$23.00". React compares that text on hydration, found it
 * different on every price on the menu, and threw the whole customer page away
 * to re-render it in the browser. Money that changes shape depending on the
 * phone it is read on is also its own problem — two diners at one table would
 * see different symbols on the same bill.
 *
 * "MX$" over "$" because a QR menu is read by people who are not all local,
 * and "$" alone is the one thing a peso price must never be mistaken for.
 */
const MONEY_LOCALE = "en-US";

/** Format a number as currency, e.g. formatMoney(14.9, "USD") → "$14.90". */
export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(MONEY_LOCALE, { style: "currency", currency }).format(amount);
}
