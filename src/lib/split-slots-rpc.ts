import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SplitOutcome } from "@/lib/split-slots";

export async function splitRpc(name: string, args: Record<string, unknown>): Promise<SplitOutcome> {
  const { data, error } = await createAdminClient().rpc(name, args);
  if (error || !data?.outcome) throw new Error(`Split ${name} failed: ${error?.message ?? "missing outcome"}`);
  return data as SplitOutcome;
}

const refusals: Record<string, string> = {
  stale: "splitChanged", changed: "splitChanged", frozen: "splitFrozen", taken: "splitSlotPaying",
  reserved: "splitSlotPaying", paid: "splitAlreadyPaid", below_minimum: "splitCombineSlots",
  conflict: "splitRequestChanged", busy: "splitAlready", nothing: "nothingToSplit", currency: "mixedCurrencies",
  gone: "splitGone", forbidden: "forbidden", invalid: "invalidRequest",
};
/** Keep the writer's refusal: a generic failure leaves a cashier guessing about cash. */
export async function splitResponse(result: SplitOutcome, accepted: string[]): Promise<NextResponse> {
  if (accepted.includes(result.outcome)) return NextResponse.json({ ok: true, ...result });
  const key = refusals[result.outcome];
  if (!key) return await apiError("apiErr.generic", 503);
  return await apiError(`apiErr.${key}`, result.outcome === "forbidden" ? 403 : result.outcome === "invalid" ? 400 : 409,
    undefined, { ...result, code: result.outcome });
}
