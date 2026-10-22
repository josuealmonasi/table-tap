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
