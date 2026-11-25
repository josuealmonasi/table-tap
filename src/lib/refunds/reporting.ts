import type { createAdminClient } from "@/lib/supabase/admin";
import { readReturnEvents } from "./events";
import { everyRow } from "@/lib/paged";

export interface ReturnSummary { completed: number; pending: number }

export async function readCompletedReturns(db: ReturnType<typeof createAdminClient>, restaurant: string,
  currency: string, start: string, end: string, includeCancellations = false): Promise<{ amount: number; count: number }> {
  const rows = await readReturnEvents(db, restaurant, start, end, { currency, kind: includeCancellations ? undefined : "return" });
  return {
    amount: rows.reduce((total, row) => total + row.amount_cents, 0) / 100,
    count: new Set(rows.map(row => row.operation_id)).size,
  };
}

/** Sales keep their original calendar. Only money successfully returned belongs
 * to this period; an unfinished promise is shown separately, without netting it. */
export async function saleReturnSummary(db: ReturnType<typeof createAdminClient>, restaurant: string,
  currency: string, start: string, end: string): Promise<ReturnSummary> {
  const [completed, pending] = await Promise.all([
    readCompletedReturns(db, restaurant, currency, start, end),
    everyRow<{ id: string; amount: number }>((a, b) => db.from("refund_operations")
      .select("id, amount, order_adjustments!inner(kind)")
      .eq("restaurant_id", restaurant).eq("currency", currency).eq("order_adjustments.kind", "return")
      .neq("status", "succeeded").order("id").range(a, b), "the outstanding return promises"),
  ]);
  const outstanding = await Promise.all(pending.map(async operation => {
    const { data, error } = await db.rpc("refund_operation_progress_v1", { p_operation: operation.id });
    if (error || !data || !Number.isSafeInteger(data.outstanding_cents) || data.outstanding_cents < 0) throw new Error("Could not verify pending returns");
    return data.outstanding_cents as number;
  }));
  return { completed: completed.amount, pending: outstanding.reduce((total, cents) => total + cents, 0) / 100 };
}
