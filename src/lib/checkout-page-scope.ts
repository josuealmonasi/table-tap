import { everyRow, IDS_PER_READ } from "@/lib/paged";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CheckoutPageScope {
  orderIds?: string[]; accountId?: string; tableId?: string; sessionId?: string; splitId?: string;
  currency?: string; includeParts?: boolean; checkoutIds?: string[];
}

/** Page through saved scopes: a truncated account must not look safe to collect. */
export async function checkoutRows<T>(read: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  return await everyRow(async (start, end) => {
    const { data, error } = await read(start, end);
    if (error || !Array.isArray(data)) throw new Error("Could not read checkout pages");
    return { data, error: null };
  }, "checkout pages", 500);
}

/** Slice URL filters too: a busy account can owe more IDs than PostgREST accepts. */
export async function checkoutRowsIn<T extends { id: string }>(ids: string[], read: (ids: string[], start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows = new Map<string, T>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += IDS_PER_READ) {
    const slice = unique.slice(i, i + IDS_PER_READ);
    for (const row of await checkoutRows<T>((start, end) => read(slice, start, end))) rows.set(row.id, row);
  }
  return [...rows.values()];
}

export async function checkoutOrderIds(restaurantId: string, scope: CheckoutPageScope): Promise<string[]> {
  if (scope.orderIds) return scope.orderIds;
  const db = createAdminClient();
  if (scope.splitId) {
    const { data, error } = await db.from("bill_splits").select("order_ids")
      .eq("id", scope.splitId).eq("restaurant_id", restaurantId).maybeSingle();
    if (error || !data) throw new Error("Could not read the divided bill");
    return data.order_ids;
  }
  if (!scope.accountId && !scope.tableId && !scope.sessionId) throw new Error("Missing checkout scope");
  let query = db.from("orders").select("id").eq("restaurant_id", restaurantId);
  if (scope.accountId) query = query.eq("account_id", scope.accountId);
  if (scope.tableId) query = query.eq("table_id", scope.tableId).is("account_id", null);
  if (scope.sessionId) query = query.eq("session_id", scope.sessionId);
  if (scope.currency && !scope.accountId) query = query.eq("currency", scope.currency);
  const orders = await checkoutRows<{ id: string }>((start, end) => query.order("id").range(start, end));
  return orders.map(o => o.id);
}

export function checkoutScope(args: Record<string, unknown>): CheckoutPageScope {
  return {
    orderIds: Array.isArray(args.p_orders) ? args.p_orders : typeof args.p_order === "string" ? [args.p_order] : undefined,
    accountId: !Array.isArray(args.p_orders) && typeof args.p_account === "string" ? args.p_account : typeof args.p_expected_account === "string" ? args.p_expected_account : undefined,
    tableId: typeof args.p_table === "string" ? args.p_table : undefined,
    sessionId: typeof args.p_session === "string" ? args.p_session : undefined,
    splitId: typeof args.p_split === "string" ? args.p_split : undefined,
    currency: typeof args.p_currency === "string" ? args.p_currency : undefined,
  };
}
