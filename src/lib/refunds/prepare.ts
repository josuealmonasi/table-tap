import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import type { Actor } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ReturnRequest {
  action?: string;
  orderId?: string;
  amountCents?: number;
  reason?: string;
  note?: string;
  ref?: string;
  dueId?: string;
  expected?: { totalCents: number; tipCents: number; serviceCents: number };
}

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const cents = (value: unknown): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;

export async function prepareReturn(body: ReturnRequest, actor: Actor): Promise<NextResponse> {
  if (body.dueId !== undefined) return await apiError("apiErr.duplicateRefundUseDue", 409);
  const expected = body.expected;
  if (!uuid(body.orderId) || !uuid(body.ref) || !cents(body.amountCents) || body.amountCents <= 0
    || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500
    || (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000))
    || !expected || !cents(expected.totalCents) || !cents(expected.tipCents) || !cents(expected.serviceCents)
    || expected.tipCents + expected.serviceCents > expected.totalCents) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  // SQL looks up the reference before today's balance. A lost full-return reply
  // must still replay after the retained total reaches zero.
  const { data, error } = await createAdminClient().rpc("return_on_order_v1", {
    p_restaurant: actor.restaurantId, p_order: body.orderId, p_amount_cents: body.amountCents,
    p_actor: actor.email, p_reason: body.reason, p_note: body.note ?? "", p_ref: body.ref,
    p_expected_total_cents: expected.totalCents, p_expected_tip_cents: expected.tipCents,
    p_expected_service_cents: expected.serviceCents,
  });
  if (error || !data) return await apiError("apiErr.verifyOrders", 503);
  if (data.outcome === "prepared") return NextResponse.json(data);
  if (data.outcome === "invalid") return await apiError("apiErr.invalidRequest", 400);
  if (data.outcome === "missing") return await apiError("apiErr.orderNotFound", 404);
  const refusals: Record<string, string> = {
    conflict: "apiErr.returnConflict", changed: "apiErr.returnChanged", capacity: "apiErr.returnCapacity",
    review: "apiErr.refundReviewRequired", split: "apiErr.returnSplit", ineligible: "apiErr.returnIneligible",
  };
  return await apiError(refusals[data.outcome] ?? "apiErr.verifyOrders", refusals[data.outcome] ? 409 : 503);
}
