import { createAdminClient } from "@/lib/supabase/admin";
import { checkoutRows, type CheckoutPageScope } from "@/lib/checkout-page-scope";
import type { PaymentCheckScope } from "@/lib/payment-check";

/** Secret-key reads must prove every requested identity belongs to this restaurant. */
export async function paymentCheckTarget(restaurantId: string, scope: PaymentCheckScope): Promise<CheckoutPageScope | null> {
  const db = createAdminClient();
  if (scope.kind === "orders") {
    const { data, error } = await db.from("orders").select("id, account_id").eq("restaurant_id", restaurantId).in("id", scope.orderIds);
    if (error) throw error;
    if (data?.length !== scope.orderIds.length) return null;
    // Cancellation of an account order must also see its account's saved page.
    return { orderIds: scope.orderIds, ...(data.length === 1 && data[0].account_id && { accountId: data[0].account_id }) };
  }
  if (scope.kind === "table") {
    const { data, error } = await db.from("tables").select("id").eq("restaurant_id", restaurantId).eq("id", scope.tableId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const orders = await checkoutRows<{ id: string }>((start, end) => db.from("orders").select("id")
      .eq("restaurant_id", restaurantId).eq("table_id", scope.tableId).eq("currency", scope.currency)
      .eq("paid", false).eq("written_off", false).is("account_id", null)
      .not("status", "in", "(cancelled,pending_payment)").order("id").range(start, end));
    return { orderIds: orders.map(o => o.id) };
  }
  if (scope.kind === "approval") {
    const { data, error } = await db.from(scope.requestKind === "discount" ? "discount_requests" : "write_off_requests")
      .select("order_ids").eq("restaurant_id", restaurantId).eq("id", scope.requestId).maybeSingle();
    if (error) throw error;
    return data ? { orderIds: data.order_ids } : null;
  }
  const table = scope.kind === "account" ? "customer_accounts" : "bill_splits";
  const id = scope.kind === "account" ? scope.accountId : scope.splitId;
  const { data, error } = await db.from(table).select("id")
    .eq("restaurant_id", restaurantId).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (scope.kind === "account") return { accountId: scope.accountId };
  return { splitId: scope.splitId, includeParts: false };
}
