import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { byDay, linesOf, type StatementCharge, type StatementDay } from "@/lib/accounts";
import { round2 } from "@/lib/money";

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
  const [accountsRes, owedRes] = await Promise.all([
    db.from("customer_accounts").select(ACCOUNT_COLUMNS).eq("restaurant_id", restaurantId)
      .order("status").order("name"),
    db.from("orders").select("account_id, total, created_at, charged_at")
      .eq("restaurant_id", restaurantId).not("account_id", "is", null)
      .eq("paid", false).neq("status", "cancelled"),
  ]);
  const accounts = unwrap(accountsRes, "the accounts") ?? [];
  const owed = new Map<string, { sum: number; last: string | null }>();
  for (const o of (unwrap(owedRes, "what the accounts owe") ?? []) as {
    account_id: string; total: number; created_at: string; charged_at: string | null;
  }[]) {
    const at = o.charged_at ?? o.created_at;
    const was = owed.get(o.account_id) ?? { sum: 0, last: null };
    owed.set(o.account_id, { sum: was.sum + Number(o.total), last: !was.last || at > was.last ? at : was.last });
  }
  return (accounts as AccountRow[]).map(a => ({
    ...a,
    credit_limit: Number(a.credit_limit),
    owed: round2(owed.get(a.id)?.sum ?? 0),
    lastChargeAt: owed.get(a.id)?.last ?? null,
  }));
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
  at: string;
  amount: number;
  tip: number;
  method: "cash" | "card";
}

/** What is owed, day by day, and what was paid before. */
export interface Statement {
  owed: number;
  days: StatementDay[];
  payments: StatementPayment[];
  /** Who charged each order — for the staff's view, never the customer's. */
  chargedBy: Record<string, string | null>;
}

/** An account's statement: its unpaid orders by the restaurant's day, and its payments. */
export async function statementOf(account: AccountRow, timeZone?: string | null): Promise<Statement> {
  const db = createAdminClient();
  const [ordersRes, paymentsRes] = await Promise.all([
    db.from("orders").select("id, items, total, table_label, created_at, charged_at, charged_by")
      .eq("account_id", account.id).eq("paid", false).neq("status", "cancelled")
      .order("created_at"),
    db.from("payments").select("amount, tip, method, created_at")
      .eq("account_id", account.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const orders = (unwrap(ordersRes, "the account's orders") ?? []) as {
    id: string; items: unknown; total: number; table_label: string | null;
    created_at: string; charged_at: string | null; charged_by: string | null;
  }[];
  const charges: StatementCharge[] = orders.map(o => ({
    orderId: o.id,
    at: o.charged_at ?? o.created_at,
    tableLabel: o.table_label,
    lines: linesOf(o.items),
    total: Number(o.total),
  }));
  const payments = (unwrap(paymentsRes, "the account's payments") ?? []) as {
    amount: number; tip: number; method: "cash" | "card"; created_at: string;
  }[];
  return {
    owed: round2(charges.reduce((sum, c) => sum + c.total, 0)),
    days: byDay(charges, timeZone ?? DEFAULT_TIME_ZONE),
    payments: payments.map(p => ({ at: p.created_at, amount: Number(p.amount), tip: Number(p.tip), method: p.method })),
    chargedBy: Object.fromEntries(orders.map(o => [o.id, o.charged_by])),
  };
}
