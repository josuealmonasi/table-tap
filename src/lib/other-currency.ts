/** Money taken in a currency other than the one being counted, by method. */
export interface OtherCurrencyTaking {
  currency: string;
  cash: number;
  card: number;
}

/** One line per other currency, for the screen and the printed sheet alike. */
export function otherCurrencyLines(
  lines: OtherCurrencyTaking[] | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
  format: (amount: number, currency: string) => string,
): string[] {
  return (lines ?? []).map(l => t("corte.otherCurrency", {
    currency: l.currency, cash: format(l.cash, l.currency), card: format(l.card, l.currency),
  }));
}
