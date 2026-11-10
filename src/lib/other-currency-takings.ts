import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import type { OtherCurrencyTaking } from "@/lib/other-currency";


/**
 * Payments in any currency but `currency` from `from` to `to`: an old peso
 * debt collected after the restaurant moved to dollars. The corte and the
 * drawer count one currency, so these were in nobody's total (sweep 8,
 * finding 3); they are listed beside it, never added to it.
 */
export async function otherCurrencyTakings(
  restaurantId: string, currency: string, from: string, to?: string,
): Promise<OtherCurrencyTaking[]> {
  const db = createAdminClient();
  // Open-ended up to now unless `to` closes it: Postgres reads "infinity" as a timestamp.
  const rows = await everyRow<{ currency: string; method: string; amount: number }>((a, b) => db.from("payments")
    .select("currency, method, amount").eq("restaurant_id", restaurantId).neq("currency", currency)
    .gte("created_at", from).lte("created_at", to ?? "infinity").order("id").range(a, b), "payments in other currencies");
  const byCurrency = new Map<string, OtherCurrencyTaking>();
  for (const row of rows) {
    const line = byCurrency.get(row.currency) ?? { currency: row.currency, cash: 0, card: 0 };
    if (row.method === "cash") line.cash += Number(row.amount);
    else line.card += Number(row.amount);
    byCurrency.set(row.currency, line);
  }
  return [...byCurrency.values()]
    .map(l => ({ ...l, cash: Math.round(l.cash * 100) / 100, card: Math.round(l.card * 100) / 100 }))
    .filter(l => l.cash !== 0 || l.card !== 0)
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
