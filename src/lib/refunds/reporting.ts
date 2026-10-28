import type { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";

export interface ReturnSummary { completed: number; pending: number }

/** Sales keep their original calendar. Only a completed return belongs to
 * this period; an unfinished promise is shown separately, without netting it. */
export async function saleReturnSummary(db: ReturnType<typeof createAdminClient>, restaurant: string,
  currency: string, start: string, end: string): Promise<ReturnSummary> {
  const read = (completed: boolean) => everyRow<{ id: string; amount: number }>((a, b) => {
    let query = db.from("refund_operations").select("id, amount, order_adjustments!inner(kind)")
      .eq("restaurant_id", restaurant).eq("currency", currency).eq("order_adjustments.kind", "return");
    query = completed ? query.eq("status", "succeeded").gte("completed_at", start).lt("completed_at", end)
      : query.neq("status", "succeeded");
    return query.order("id").range(a, b);
  }, "the period's completed returns and pending promises");
  const [completed, pending] = await Promise.all([read(true), read(false)]);
  const outstanding = await Promise.all(pending.map(async operation => {
    const { data, error } = await db.rpc("refund_operation_progress_v1", { p_operation: operation.id });
    if (error || !data || !Number.isSafeInteger(data.outstanding_cents) || data.outstanding_cents < 0) throw new Error("Could not verify pending returns");
    return data.outstanding_cents as number;
  }));
  const sum = (rows: { amount: number }[]) => Math.round(rows.reduce((total, row) => total + Number(row.amount), 0) * 100) / 100;
  return { completed: sum(completed), pending: outstanding.reduce((total, cents) => total + cents, 0) / 100 };
}
