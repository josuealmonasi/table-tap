import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingManager } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { refundDue } from "@/lib/refund-due";

export const runtime = "nodejs";

/**
 * POST /api/refunds-due — give a diner back a card payment that arrived for a
 * bill already collected. Body: `{ id }`, a row of `refunds_due`.
 *
 * Owner or manager, the same line as cancelling a paid order: both move money
 * back out. Read and written with the secret key, scoped to the actor's own
 * restaurant — the id alone never reaches another one's row.
 *
 * Not refused on a locked subscription. The money is the diner's, and a
 * billing dispute with the restaurant is no reason to keep it from them.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{ id?: unknown }>(req);
  if (!body || typeof body.id !== "string") return await apiError("apiErr.invalidRequest", 400);

  const answer = await refundDue(createAdminClient(), actor.restaurantId, body.id, actor.email);
  if (!answer.ok) return await apiError(answer.error, answer.status);
  return NextResponse.json({ ok: true, amount: answer.amount, alreadyInStripe: answer.alreadyInStripe });
}
