import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { byDay, linesOf, type StatementCharge, type StatementDay } from "@/lib/accounts";
import { round2 } from "@/lib/money";
import { currencyBalances, type CurrencyBalance } from "@/lib/currency-balances";

// Customer accounts, read with the secret key: the table has no policy at all,
// so nothing reaches one except through a route that has checked who is asking.

export interface AccountRow {
  id: string;
  restaurant_id: string;
  name: string;
  email: string | null;
  code: string;
  credit_limit: number;
  status: "open" | "closed";
  opened_by: string;
  opened_at: string;
  closed_at: string | null;
  checkout_until: string | null;
}

const ACCOUNT_COLUMNS =
  "id, restaurant_id, name, email, code, credit_limit, status, opened_by, opened_at, closed_at, checkout_until";

/** An account and what it owes, as the staff list shows it. */
export interface AccountSummary extends AccountRow {
  owed: number;
  currency?: string | null;
  balances?: CurrencyBalance[];
  lastChargeAt: string | null;
}


/** A read that failed throws: "no accounts" and "could not look" are not one answer. */
function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T | null {
  if (res.error) throw new Error(`Could not read ${what}: ${res.error.message}`);
  return res.data;
}

/** Every account of a restaurant with its balance, open ones first. */
export async function listAccounts(restaurantId: string): Promise<AccountSummary[]> {
  const db = createAdminClient();
  // Every row: an account's balance summed from the first thousand unpaid
  // orders is a balance that stops growing while the customer keeps eating.
  const [accounts, owedRows] = await Promise.all([
    everyRow<AccountRow>((a, b) => db.from("customer_accounts").select(ACCOUNT_COLUMNS).eq("restaurant_id", restaurantId)
      .order("status").order("name").order("id").range(a, b), "the accounts"),
    everyRow<{ account_id: string; total: number; currency: string; created_at: string; charged_at: string | null }>((a, b) => db
      .from("orders").select("account_id, total, currency, created_at, charged_at")
      .eq("restaurant_id", restaurantId).not("account_id", "is", null)
      .eq("paid", false).eq("written_off", false).neq("status", "cancelled")
      .order("id").range(a, b), "what the accounts owe"),
  ]);
  const owed = new Map<string, { last: string | null }>();
  for (const o of owedRows) {
    const at = o.charged_at ?? o.created_at;
    const was = owed.get(o.account_id) ?? { last: null };
    owed.set(o.account_id, { last: !was.last || at > was.last ? at : was.last });
  }
  return accounts.map(a => {
    const balances = currencyBalances(owedRows.filter(o => o.account_id === a.id).map(o => ({ currency: o.currency, amount: Number(o.total) })));
    return {
      ...a,
      credit_limit: Number(a.credit_limit),
      owed: balances.length === 1 ? balances[0].amount : 0,
      currency: balances.length === 1 ? balances[0].currency : null,
      balances,
      lastChargeAt: owed.get(a.id)?.last ?? null,
    };
  });
}

/** One account of a restaurant, or null. */
export async function accountById(restaurantId: string, id: string): Promise<AccountRow | null> {
  const res = await createAdminClient().from("customer_accounts").select(ACCOUNT_COLUMNS)
    .eq("restaurant_id", restaurantId).eq("id", id).maybeSingle();
  return unwrap(res, "the account") as AccountRow | null;
}

/** The account a statement's code belongs to, or null. */
export async function accountByCode(code: string): Promise<AccountRow | null> {
  const res = await createAdminClient().from("customer_accounts").select(ACCOUNT_COLUMNS)
    .eq("code", code).maybeSingle();
  return unwrap(res, "the account") as AccountRow | null;
}

export interface StatementPayment {
  currency?: string;
  at: string;
  amount: number;
  tip: number;
  method: "cash" | "card";
}

/** What is owed, day by day, and what was paid before. */
export interface Statement {
  currency?: string | null;
  balances?: CurrencyBalance[];
  owed: number;
  days: StatementDay[];
  payments: StatementPayment[];
  /** Who charged each order — for the staff's view, never the customer's. */
  chargedBy: Record<string, string | null>;
  returns: { id: string; amount: number; currency: string; status: string; created_at: string }[];
}

interface StatementOrder {
  currency: string;
  id: string;
  items: unknown;
  total: number;
  table_label: string | null;
  created_at: string;
  charged_at: string | null;
  charged_by: string | null;
}

/** An account's statement: its unpaid orders by the restaurant's day, and its payments. */
export async function statementOf(account: AccountRow, timeZone?: string | null): Promise<Statement> {
  const db = createAdminClient();
  const [orders, paymentsRes] = await Promise.all([
    everyRow<StatementOrder>((a, b) => db.from("orders").select("id, items, total, currency, table_label, created_at, charged_at, charged_by")
      .eq("restaurant_id", account.restaurant_id).eq("account_id", account.id).eq("paid", false).eq("written_off", false).neq("status", "cancelled")
      .order("id").range(a, b), "the account's orders"),
    db.from("payments").select("amount, tip, currency, method, created_at")
      .eq("restaurant_id", account.restaurant_id).eq("account_id", account.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const returns = await everyRow<{ id: string; amount: number; currency: string; status: string; created_at: string }>((a, b) => db
    .from("refund_operations").select("id, amount, currency, status, created_at, order_adjustments!inner(orders!inner(account_id))")
    .eq("restaurant_id", account.restaurant_id).eq("order_adjustments.orders.account_id", account.id)
    .order("id").range(a, b), "the account's returns");
  const charges: StatementCharge[] = orders.map(o => ({
    currency: o.currency,
    orderId: o.id,
    at: o.charged_at ?? o.created_at,
    tableLabel: o.table_label,
    lines: linesOf(o.items),
    total: Number(o.total),
  }));
  const payments = (unwrap(paymentsRes, "the account's payments") ?? []) as {
    amount: number; tip: number; currency: string; method: "cash" | "card"; created_at: string;
  }[];
  const balances = currencyBalances(orders.map(o => ({ currency: o.currency, amount: Number(o.total) })));
  return {
    currency: balances.length === 1 ? balances[0].currency : null,
    balances,
    owed: balances.length > 1 ? 0 : round2(charges.reduce((sum, c) => sum + c.total, 0)),
    days: byDay(charges, timeZone ?? DEFAULT_TIME_ZONE),
    payments: payments.map(p => ({ at: p.created_at, amount: Number(p.amount), tip: Number(p.tip), method: p.method, currency: p.currency })),
    returns: returns.map(r => ({ id: r.id, amount: Number(r.amount), currency: r.currency, status: r.status, created_at: r.created_at })),
    chargedBy: Object.fromEntries(orders.map(o => [o.id, o.charged_by])),
  };
}
