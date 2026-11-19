import type { createAdminClient } from "@/lib/supabase/admin";

interface Progress { operation_id: string; outstanding_cents: number; unresolved: boolean }

/** Read one batch at a time, in operation-id order. One batch keeps a polled returns list out of the PostgREST connection queue.
 * Continue only if the server caps it: a missing balance must never look paid. */
export async function refundProgress(db: ReturnType<typeof createAdminClient>, restaurant: string,
  ids: string[]): Promise<Map<string, number>> {
  const balances = new Map<string, number>();
  const expected = new Set(ids);
  while (balances.size < expected.size) {
    const { data, error } = await db.rpc("refund_operations_progress_v1", {
      p_restaurant: restaurant, p_ids: [...expected],
    }).order("operation_id").range(balances.size, expected.size - 1);
    if (error || !data?.length) throw new Error("Could not verify the outstanding return");
    for (const row of data as Progress[]) {
      if (!expected.has(row.operation_id) || balances.has(row.operation_id)
        || !Number.isSafeInteger(row.outstanding_cents) || row.outstanding_cents < 0) {
        throw new Error("Could not verify the outstanding return");
      }
      balances.set(row.operation_id, row.outstanding_cents);
    }
  }
  return balances;
}
