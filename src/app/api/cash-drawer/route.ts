import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingManager, actingStaff } from "@/lib/api-guard";
import { HOLDS_THE_DRAWER } from "@/lib/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { cashAmount, cashNote } from "@/lib/cash-drawer";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { uuidOf } from "@/lib/costs/guard";
import { openShift } from "@/lib/cash-shift-server";

export const runtime = "nodejs";

// POST /api/cash-drawer — cash taken out of the drawer.
//
// { kind: "withdrawal", amount, note?, purpose?: "tips" | "other" }
//
// The people who run the drawer: owner, manager, cashier. It belongs to the
// shift open now, and there has to be one: cash taken out of a drawer nobody
// opened cannot be counted against anything. Not a sale, so not `payments`.
// (The opening amount is the shift's own: /api/cash-shift.)
//
// A cashier's withdrawal waits for a manager (PATCH below) before it leaves
// expected cash, and none may take expected cash below zero: recorded as a
// "withdrawal", MX$60 of missing cash closed with no difference (2026-11-25).
export async function POST(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor || !HOLDS_THE_DRAWER(actor.role)) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{ kind?: unknown; amount?: unknown; note?: unknown; purpose?: unknown; ref?: unknown; shiftId?: unknown }>(req);
  if (body?.kind !== "withdrawal") return await apiError("apiErr.invalidRequest", 400);
  const purpose = body.purpose === undefined ? "other" : body.purpose;
  if (purpose !== "tips" && purpose !== "other") return await apiError("apiErr.invalidRequest", 400);
  const amount = cashAmount(body?.amount, true);
  if (amount === null) return await apiError("apiErr.cashAmount", 400);
  const note = cashNote(body?.note);
  const ref = uuidOf(body.ref);
  const reviewedShift = uuidOf(body.shiftId);
  if (body.ref !== undefined && (!ref || !reviewedShift)) return await apiError("apiErr.invalidRequest", 400);
  const shift = reviewedShift ? { id: reviewedShift } : await openShift(actor.restaurantId);
  if (!shift) return await apiError("apiErr.noOpenShift", 409);

  // Close and withdrawals share the money lock; this read alone cannot
  // promise that the shift will still be open when the withdrawal is written.
  const { data, error } = await createAdminClient().rpc(ref ? "create_cash_withdrawal_once" : "create_cash_withdrawal", {
    ...(ref ? { p_ref: ref } : {}),
    p_restaurant: actor.restaurantId, p_shift: shift.id, p_amount: amount, p_note: note, p_actor: actor.email,
    p_role: actor.role, p_purpose: purpose,
  });
  if (error?.code === "PT409") return await apiError("apiErr.retryConflict", 409);
  if (error?.code === "PT422") return await apiError("apiErr.cashWithdrawalOverDrawer", 409);
  if (error) return await apiError("apiErr.generic", 500);
  if (!data) return await apiError("apiErr.noOpenShift", 409);
  // A late retry of a withdrawal a manager has since removed: nothing was
  // written again, and the person is told so rather than shown "recorded".
  if (data.outcome === "removed") return NextResponse.json({ ok: true, id: data.id, removed: true });

  const pending = data.status === "pending";
  await logEvent({
    operationKey: `withdrawal:${data.id}`,
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "cash",
    action: pending ? "requested" : "created",
    detail: logDetail({ withdrawal: amount.toFixed(2), note, currency: data.currency }),
  });
  return NextResponse.json({
    ok: true, id: data.id,
    ...(pending ? { pending: true } : {}), ...(data.status === "rejected" ? { rejected: true } : {}),
  });
}

// PATCH /api/cash-drawer — a manager approves or rejects a cashier's pending
// withdrawal. { id, decision: "approve" | "reject" }
//
// Only in the shift still open, under the money lock: an approval must still
// fit in the drawer as it stands, and a closed shift was counted without it.
export async function PATCH(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: unknown; decision?: unknown }>(req);
  const id = uuidOf(body?.id);
  const decision = body?.decision === "approve" ? "approved" : body?.decision === "reject" ? "rejected" : null;
  if (!id || !decision) return await apiError("apiErr.invalidRequest", 400);

  const shift = await openShift(actor.restaurantId);
  if (!shift) return await apiError("apiErr.cashMovementNotFound", 404);
  const { data, error } = await createAdminClient().rpc("review_cash_withdrawal", {
    p_restaurant: actor.restaurantId, p_shift: shift.id, p_movement: id, p_actor: actor.email,
    p_role: actor.role, p_decision: decision,
  });
  if (error?.code === "PT422") return await apiError("apiErr.cashWithdrawalOverDrawer", 409);
  if (error) return await apiError("apiErr.generic", 500);
  if (!data) return await apiError("apiErr.cashMovementNotFound", 404);
  if (data.outcome === "decided") return await apiError("apiErr.cashWithdrawalDecided", 409);

  if (!data.repeat) await logEvent({
    operationKey: `withdrawal-review:${data.id}`,
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "cash",
    action: decision,
    detail: logDetail({ withdrawal: Number(data.amount).toFixed(2), note: data.note, currency: data.currency }),
  });
  return NextResponse.json({ ok: true, status: decision });
}

// DELETE /api/cash-drawer — strike off a withdrawal written by mistake.
//
// A manager's alone: a cashier who could erase what they took out of the
// drawer would make the record worth nothing. Only this restaurant's, and
// only in the shift still open: a closed shift was counted against its
// withdrawals, and striking one off afterwards would rewrite that count.
export async function DELETE(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: unknown }>(req);
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return await apiError("apiErr.invalidRequest", 400);

  const shift = await openShift(actor.restaurantId);
  if (!shift) return await apiError("apiErr.cashMovementNotFound", 404);
  const { data, error } = await createAdminClient().rpc("delete_cash_withdrawal", {
    p_restaurant: actor.restaurantId, p_shift: shift.id, p_movement: id,
  });
  if (error) return await apiError("apiErr.generic", 500);
  if (!data) return await apiError("apiErr.cashMovementNotFound", 404);
  if (data.outcome === "linked") return await apiError("apiErr.cashWithdrawalLinked", 409);

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "cash",
    action: "deleted",
    detail: logDetail({ withdrawal: Number(data.amount).toFixed(2), note: data.note, currency: data.currency }),
  });
  return NextResponse.json({ ok: true });
}
