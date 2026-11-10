import { resolveSelectedSplitPages } from "@/lib/split-page-recovery";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SplitOutcome } from "@/lib/split-slots";
import { closeExpiredWholeBillPages } from "@/lib/whole-bill-pages";

async function callSplit(name: string, args: Record<string, unknown>): Promise<SplitOutcome> {
  const { data, error } = await createAdminClient().rpc(name, args);
  if (error || !data?.outcome) throw new Error(`Split ${name} failed: ${error?.message ?? "missing outcome"}`);
  return data as SplitOutcome;
}

export async function splitRpc(name: string, args: Record<string, unknown>): Promise<SplitOutcome> {
  const result = await callSplit(name, args);
  // A whole-bill card page refuses the split until it is resolved. One Stripe
  // already expired is closed here and the call tried once more (#576 R1).
  if (result.outcome === "paying" && typeof args.p_restaurant === "string"
    && await closeExpiredWholeBillPages(args.p_restaurant, args)) return await callSplit(name, args);
  if (["taken", "reserved"].includes(result.outcome) && typeof args.p_restaurant === "string"
    && typeof args.p_split === "string" && Array.isArray(args.p_slots)
    && await resolveSelectedSplitPages(args.p_restaurant, args.p_split, args.p_slots) === "closed") {
    return await callSplit(name, args);
  }
  return result;
}

const refusals: Record<string, string> = {
  stale: "splitChanged", changed: "splitChanged", frozen: "splitFrozen", taken: "splitSlotPaying",
  reserved: "splitSlotPaying", paid: "splitSlotPaid", below_minimum: "splitCombineSlots",
  conflict: "splitRequestChanged", busy: "splitAlready", nothing: "nothingToSplit", currency: "mixedCurrencies",
  gone: "splitGone", forbidden: "forbidden", invalid: "invalidRequest", paying: "splitBillPaying",
};
/** Keep the writer's refusal: a generic failure leaves a cashier guessing about cash. */
export async function splitResponse(result: SplitOutcome, accepted: string[]): Promise<NextResponse> {
  if (accepted.includes(result.outcome)) return NextResponse.json({ ok: true, ...result });
  const key = refusals[result.outcome];
  if (!key) return await apiError("apiErr.generic", 503);
  return await apiError(`apiErr.${key}`, result.outcome === "forbidden" ? 403 : result.outcome === "invalid" ? 400 : 409,
    undefined, { ...result, code: result.outcome });
}
