import { NextRequest, NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { openShift, shiftWithdrawals } from "@/lib/cash-shift-server";
import { RESOLUTION_ERRORS, validResolution } from "@/lib/held-resolution";

export const runtime = "nodejs";

/** Only recorded withdrawals in this manager's open shift can back returned cash. */
export async function GET(): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  try {
    const shift = await openShift(actor.restaurantId);
    const withdrawals = shift ? await shiftWithdrawals(actor.restaurantId, shift.id) : [];
    return NextResponse.json({ restaurantId: actor.restaurantId, shiftId: shift?.id ?? null, withdrawals });
  } catch { return await apiError("apiErr.generic", 503); }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<Record<string, unknown>>(req);
  if (!validResolution(body) || body.restaurantId !== actor.restaurantId) return await apiError("apiErr.heldResolveInvalid", 400);
  const { data, error } = await createAdminClient().rpc("resolve_held_sale", {
    p_restaurant: actor.restaurantId, p_ref: body.posRef, p_actor: actor.email,
    p_reason: body.reason.trim(), p_disposition: body.disposition, p_collector: body.collector.trim(),
    p_amount: Math.round(body.amount * 100) / 100, p_currency: body.currency, p_collected_at: body.collectedAt,
    p_payment: body.paymentId ?? null, p_cash_receipt: body.cashReceiptId ?? null, p_payout: body.payoutId ?? null,
  });
  if (error) {
    const mapped = RESOLUTION_ERRORS[error.message];
    if (mapped) return await apiError(`apiErr.${mapped[0]}`, mapped[1]);
    if (error.code === "23505") return await apiError("apiErr.heldResolveLinkUsed", 409);
    if (error.code === "PT409") return await apiError("apiErr.heldResolveDecided", 409);
    return await apiError("apiErr.generic", 503);
  }
  if (!data) return await apiError("apiErr.generic", 503);
  // The RPC returns its immutable record on both the first call and a retry.
  return NextResponse.json(data);
}
