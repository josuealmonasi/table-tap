import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";

export const BATCH_SIZE = 10;
export const JOB_BUDGET_MS = 10_000;
const OVERDUE_SECONDS = 6 * 3600;

export interface RecoveryContext {
  db: ReturnType<typeof createAdminClient>;
  client: Stripe;
  deadline: number;
}
export interface PendingItem { restaurant_id: string; created_at: string }
export interface Snapshot<T> { data: T[] | null; count: number | null; error: { message: string } | null }
export interface RecoveryResult {
  done: number;
  pending: number | null;
  failed: number;
  oldest_pending_at: string | null;
  oldest_pending_age_seconds: number | null;
  age_basis: string;
  observation_failed?: boolean;
}
export type RecoveryJob = (context: RecoveryContext) => Promise<RecoveryResult>;

export async function isolateJob(name: string, run: () => Promise<RecoveryResult>): Promise<RecoveryResult> {
  try { return await run(); }
  catch (error) {
    console.error("Recovery job failed", name, error);
    return { done: 0, pending: null, failed: 1, oldest_pending_at: null,
      oldest_pending_age_seconds: null, age_basis: "unknown", observation_failed: true };
  }
}

/** Reserve time to count what remains, rather than calling a partial batch a drained queue. */
export function hasTime(context: RecoveryContext): boolean {
  return Date.now() < context.deadline - 2000;
}

export async function runBatch<T extends PendingItem>(
  name: string, context: RecoveryContext, load: (limit: number, offset?: number) => PromiseLike<Snapshot<T>>,
  recover: (item: T) => Promise<boolean | number>, ageBasis = "created_at",
  onOverdue?: (item: T) => Promise<void>,
): Promise<RecoveryResult> {
  const result: RecoveryResult = { done: 0, pending: null, failed: 0,
    oldest_pending_at: null, oldest_pending_age_seconds: null, age_basis: ageBasis };
  let batch = await load(BATCH_SIZE);
  if (batch.error) throw new Error(`${name} discovery failed: ${batch.error.message}`);
  // Persistently unpaid subscriptions and review-only fees stay queued. A
  // rotating ten-minute page keeps their first batch from hiding everyone else.
  const pages = Math.ceil((batch.count ?? 0) / BATCH_SIZE);
  const offset = pages > 1 ? (Math.floor(Date.now() / 600_000) % pages) * BATCH_SIZE : 0;
  if (offset) batch = await load(BATCH_SIZE, offset);
  if (batch.error) throw new Error(`${name} discovery failed: ${batch.error.message}`);
  for (const item of batch.data ?? []) {
    if (!hasTime(context)) break;
    try {
      const done = await recover(item);
      result.done += Number(done);
    } catch (error) {
      result.failed++;
      console.error("Recovery item failed", name, item.restaurant_id, error);
    }
  }
  try {
    const remaining = await load(1);
    if (remaining.error || remaining.count === null) throw new Error(remaining.error?.message ?? "Missing queue count");
    result.pending = remaining.count;
    const oldest = remaining.data?.[0];
    if (oldest) {
      result.oldest_pending_at = oldest.created_at;
      result.oldest_pending_age_seconds = Math.max(0, Math.floor((Date.now() - Date.parse(oldest.created_at)) / 1000));
      // Only duplicate-payment refunds have an existing matching bell kind.
      // Reusing a stock warning for a stuck fee would send owners to stock.
      if (result.oldest_pending_age_seconds > OVERDUE_SECONDS) {
        console.warn("Recovery overdue", { job: name, restaurant_id: oldest.restaurant_id,
          oldest_pending_at: oldest.created_at, age_basis: ageBasis });
        if (onOverdue) await onOverdue(oldest);
      }
    }
  } catch (error) {
    result.failed++;
    result.observation_failed = true;
    console.error("Recovery observation failed", name, error);
  }
  return result;
}
