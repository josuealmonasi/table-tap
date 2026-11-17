import { hasTime, type RecoveryContext, type RecoveryResult } from "./job";

export async function purgeAccounting(context: RecoveryContext): Promise<RecoveryResult> {
  if (!hasTime(context)) throw new Error("Accounting purge deadline reached");
  const { data, error } = await context.db.rpc("purge_expired_accounting_records", {});
  if (error) throw new Error(error.message);
  const result = data as { deleted?: unknown; pending?: unknown; oldest?: unknown } | null;
  if (!result || !Number.isSafeInteger(result.deleted) || Number(result.deleted) < 0 || Number(result.deleted) > 1000 ||
      !Number.isSafeInteger(result.pending) || Number(result.pending) < 0 ||
      (result.oldest !== null && (typeof result.oldest !== "string" || !Number.isFinite(Date.parse(result.oldest)))) ||
      (Number(result.pending) === 0) !== (result.oldest === null)) {
    throw new Error("Invalid accounting purge result");
  }
  const oldest = result.oldest as string | null;
  return { done: Number(result.deleted), pending: Number(result.pending), failed: 0,
    oldest_pending_at: oldest, oldest_pending_age_seconds: oldest ? Math.max(0, Math.floor((Date.now() - Date.parse(oldest)) / 1000)) : null,
    age_basis: "deleted_at" };
}
