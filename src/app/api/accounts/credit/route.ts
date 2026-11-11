import { NextResponse, type NextRequest } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWriteOffReason, noteProblem } from "@/lib/write-off";
import { validCreditCents } from "@/lib/account-credit";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refusals: Record<string, [string, number]> = {
  invalid: ["apiErr.accountCreditInvalid", 400], reason: ["apiErr.accountCreditReason", 400],
  note: ["apiErr.accountCreditNote", 400], missing: ["apiErr.notFound", 404],
  ineligible: ["apiErr.accountCreditIneligible", 409], paying: ["apiErr.accountPayingOnline", 409],
  changed: ["apiErr.accountCreditChanged", 409], capacity: ["apiErr.accountCreditCapacity", 409],
  conflict: ["apiErr.accountCreditConflict", 409], review: ["apiErr.accountCreditReview", 409],
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<Record<string, unknown>>(req);
  if (!body || typeof body.orderId !== "string" || !uuid.test(body.orderId)
    || typeof body.requestId !== "string" || !uuid.test(body.requestId)
    || !validCreditCents(body.amountCents) || !validCreditCents(body.expectedCents)) {
    return await apiError("apiErr.accountCreditInvalid", 400);
  }
  if (!isWriteOffReason(body.reason)) return await apiError("apiErr.accountCreditReason", 400);
  if (typeof body.note !== "string" || noteProblem(body.reason, body.note)) return await apiError("apiErr.accountCreditNote", 400);
  const { data, error } = await createAdminClient().rpc("account_credit_v1", {
    p_restaurant: actor.restaurantId, p_order: body.orderId,
    p_amount_cents: body.amountCents, p_expected_cents: body.expectedCents,
    p_reason: body.reason, p_note: body.note.trim(), p_actor: actor.email, p_request: body.requestId,
  });
  if (error || !data) return await apiError("apiErr.generic", 500);
  if (data.outcome !== "credited") {
    const [key, status] = refusals[data.outcome] ?? ["apiErr.generic", 500];
    return await apiError(key, status);
  }
  return NextResponse.json({ ok: true, adjustmentId: data.adjustmentId,
    amountCents: data.amountCents, remainingCents: data.remainingCents, currency: data.currency });
}
