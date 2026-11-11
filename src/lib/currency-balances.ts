import { round2 } from "@/lib/money";
import { formatMoney } from "@/lib/format";

export interface CurrencyBalance { currency: string; amount: number }

/** Saved currencies are separate debts. Adding their numbers is not a balance. */
export function currencyBalances(rows: { currency: string; amount: number }[]): CurrencyBalance[] {
  const sums = new Map<string, number>();
  for (const row of rows) sums.set(row.currency, round2((sums.get(row.currency) ?? 0) + Number(row.amount)));
  return [...sums].map(([currency, amount]) => ({ currency, amount }));
}

export function balancesLabel(balances: CurrencyBalance[]): string {
  return balances.map(b => formatMoney(b.amount, b.currency)).join(" · ");
}

/**
 * What an account owes, as one label. An account with no charges has no
 * balances at all, and joining nothing gave an empty string: the row read
 * "Debe  de MX$1,000.00" (owner's screenshot, 2026-11-10). Nothing owed is a
 * zero in the account's own currency.
 */
export function owedLabel(balances: CurrencyBalance[] | undefined, currency: string): string {
  return balances && balances.length > 0 ? balancesLabel(balances) : formatMoney(0, currency);
}
