import type { AnalyticsOrder } from "@/lib/analytics";
import type { CortePayment } from "@/lib/corte";
import { everyRow } from "@/lib/paged";
import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

export interface PaidAnalyticsOrder extends AnalyticsOrder {
  id: string;
  currency: string;
  table_id: string | null;
  table_label: string | null;
}

/** Sales follow order creation on the restaurant's calendar. */
export function readAnalyticsOrders(db: Db, restaurantId: string, currency: string, from: string, to: string) {
  return everyRow<PaidAnalyticsOrder>((a, b) => db.from("orders")
    .select("id, currency, total, service_fee, tip, created_at, items, table_id, table_label")
    .eq("restaurant_id", restaurantId).eq("currency", currency).eq("paid", true).neq("status", "cancelled")
    .gte("created_at", from).lt("created_at", to).order("id").range(a, b), "the period's sales");
}

/** Takings follow the payment ledger's clock, including online card payments. */
export function readCortePayments(db: Db, restaurantId: string, currency: string, from: string, to?: string) {
  return everyRow<CortePayment>((a, b) => {
    const query = db.from("payments").select("actor_email, amount, method")
      .eq("restaurant_id", restaurantId).eq("currency", currency).gte("created_at", from)
      .order("id").range(a, b);
    return to ? query.lt("created_at", to) : query;
  }, "the period's takings");
}
