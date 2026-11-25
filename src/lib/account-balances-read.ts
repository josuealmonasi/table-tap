import { currencyBalances } from "@/lib/currency-balances";
import { everyRow } from "@/lib/paged";
import type { createAdminClient } from "@/lib/supabase/admin";

interface AccountCharge {
  account_id: string;
  total: number;
  currency: string;
  created_at: string;
  charged_at: string | null;
}

export async function readAccountBalances(db: ReturnType<typeof createAdminClient>, restaurantId: string) {
  const rows = await everyRow<AccountCharge>((a, b) => db.from("orders")
    .select("account_id, total, currency, created_at, charged_at")
    .eq("restaurant_id", restaurantId).not("account_id", "is", null)
    .eq("paid", false).eq("written_off", false).neq("status", "cancelled")
    .order("id").range(a, b), "what the accounts owe");
  const byAccount = new Map<string, AccountCharge[]>();
  for (const row of rows) {
    const charges = byAccount.get(row.account_id) ?? [];
    charges.push(row);
    byAccount.set(row.account_id, charges);
  }
  return new Map([...byAccount].map(([id, charges]) => [id, {
    last: charges.reduce((last, charge) => {
      const at = charge.charged_at ?? charge.created_at;
      return at > last ? at : last;
    }, ""),
    balances: currencyBalances(charges.map(o => ({ currency: o.currency, amount: o.total }))),
  }]));
}

export async function readOpenAccountDebt(db: ReturnType<typeof createAdminClient>, restaurantId: string) {
  const [accounts, owed] = await Promise.all([
    everyRow<{ id: string }>((a, b) => db.from("customer_accounts").select("id")
      .eq("restaurant_id", restaurantId).eq("status", "open").order("id").range(a, b), "the open accounts"),
    readAccountBalances(db, restaurantId),
  ]);
  const owing = accounts.map(({ id }) => (owed.get(id)?.balances ?? []).filter(b => b.amount > 0)).filter(b => b.length);
  return { count: owing.length, balances: currencyBalances(owing.flat()) };
}
