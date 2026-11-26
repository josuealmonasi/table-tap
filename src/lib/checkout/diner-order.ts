import type { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";

/** Why the database would not save a diner's table order. */
export type DinerOrderRefusal = "sittingClosed" | "notMember" | "payLaterNeedsStaff" | "sittingPayLaterFull";

const REFUSALS: DinerOrderRefusal[] = ["sittingClosed", "notMember", "payLaterNeedsStaff", "sittingPayLaterFull"];

export interface DinerOrderInsert {
  id: string | null;
  refusal: DinerOrderRefusal | null;
  error: { code?: string; message: string } | null;
}

/** The refusal named in a writer's answer, if any. */
export function dinerOrderRefusal(result: object | null | undefined): DinerOrderRefusal | null {
  if (!result) return null;
  return REFUSALS.find(key => (result as Record<string, unknown>)[key] === true) ?? null;
}

/**
 * A diner's table order without a retry reference, saved only into an open
 * sitting. The route opened (or joined) the sitting in an earlier call, and a
 * cashier could close it in between: the insert holds the sitting FOR SHARE
 * and refuses a closed one. A pay-later order is also refused for a phone
 * nobody vouched for, or past the sitting's ceiling (2026-11-26).
 */
export async function insertDinerOrder(
  restaurantId: string, order: object, member: string, deferred: boolean,
): Promise<DinerOrderInsert> {
  const { data, error } = await createAdminClient().rpc("create_diner_order_v1", {
    p_restaurant: restaurantId, p_order: order, p_member: member, p_deferred: deferred,
  });
  if (error) return { id: null, refusal: null, error };
  const result = data as { orderId?: string } | null;
  const refusal = dinerOrderRefusal(result);
  if (refusal) return { id: null, refusal, error: null };
  return { id: result?.orderId ?? null, refusal: null, error: null };
}

/** The diner's answer for each refusal, in their language. */
export async function refuseDinerOrder(refusal: DinerOrderRefusal): Promise<NextResponse> {
  switch (refusal) {
    case "sittingClosed": return await apiError("apiErr.tableBillClosedScan", 409);
    case "notMember": return await apiError("apiErr.tableJoin", 403);
    case "payLaterNeedsStaff": return await apiError("apiErr.payLaterNeedsStaff", 409);
    case "sittingPayLaterFull": return await apiError("apiErr.tablePayLaterFull", 409);
  }
}
