import { checkoutPageRpc } from "@/lib/checkout-page-rpc";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingManager } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { closeSessionsFor } from "@/lib/table-session";
import { NOTE_MAX, writableOff, writeOffTotal } from "@/lib/write-off";
import { applyWriteOffRest, coverageByOrder, owedCents, hasLockedSlotSplit, REST_REFUSAL } from "@/lib/write-off-rest";

export const runtime = "nodejs";

/**
 * POST /api/bill/write-off/approve — a manager decides on a waiter's request.
 *
 * What gets written off is re-read here rather than trusted from the row.
 * Between the ask and the decision the table may have paid, been written off
 * by someone else, or ordered another round. The manager approves the amount
 * shown on the ask: the orders are locked and checked again in the write's own
 * transaction, and a debt that changed needs a new request rather than quietly
 * approving a different amount.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{
    requestId?: string;
    approve?: boolean;
    reviewedAmount?: number;
    note?: string;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { requestId, approve, note, reviewedAmount } = body;
  if (!requestId) return await apiError("apiErr.invalidRequest", 400);
  if (typeof approve !== "boolean" || (approve &&
    (typeof reviewedAmount !== "number" || !Number.isFinite(reviewedAmount) || reviewedAmount <= 0))) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const decidedNote = String(note ?? "").trim().slice(0, NOTE_MAX);

  const db = createAdminClient();
  const { data: request } = await db
    .from("write_off_requests")
    .select("id, order_ids, table_label, reason, note, requested_by, status, amount")
    .eq("id", requestId)
    .eq("restaurant_id", actor.restaurantId)
    .eq("status", "pending")
    .maybeSingle();
  if (!request) return await apiError("apiErr.requestGone", 409);

  const decide = async (status: "rejected") =>
    await db
      .from("write_off_requests")
      .update({
        status,
        decided_by: actor.email,
        decided_at: new Date().toISOString(),
        decided_note: decidedNote || null,
      })
      .eq("id", request.id)
      .eq("status", "pending"); // two managers, one decision

  if (!approve) {
    await decide("rejected");
    await logEvent({
      restaurantId: actor.restaurantId,
      actor: actor.email,
      entity: "bill",
      action: "rejected",
      detail: logDetail({
        table: request.table_label ?? "",
        reason: request.reason,
        requestedBy: request.requested_by,
        note: decidedNote || null,
      }),
      targetEmail: request.requested_by,
    });
    return NextResponse.json({ ok: true, approved: false });
  }

  if (Number(request.amount) !== reviewedAmount) return await apiError("apiErr.approvalChanged", 409);

  const { data: rows, error: readError } = await db
    .from("orders")
    .select("id, total, paid, written_off, status, table_label, session_id, currency")
    .is("account_id", null)
    .eq("restaurant_id", actor.restaurantId)
    .in("id", request.order_ids as string[]);

  if (readError) return await apiError("apiErr.verifyOrders", 503);
  const orders = writableOff(rows ?? []);
  if (orders.length === 0) {
    // Settled or already cancelled while the ask was waiting: closing the
    // request is the honest outcome, and nothing is written off twice.
    await decide("rejected");
    return await apiError("apiErr.nothingToWriteOff", 409);
  }

  // A part-paid table was asked for its rest: approving writes off only what
  // nobody paid, and marks the request decided in the same transaction.
  const paidBy = await coverageByOrder(actor.restaurantId, orders.map(o => o.id));
  if (paidBy === null) return await apiError("apiErr.verifyOrders", 503);
  const paid = Math.round([...paidBy.values()].reduce((a, b) => a + b, 0) * 100) / 100;
  const divided = paid > 0 ? true : await hasLockedSlotSplit(actor.restaurantId, orders);
  if (divided === null) return await apiError("apiErr.verifyOrders", 503);
  if (divided) {
    const expectedCents = owedCents(orders, paidBy);
    // Asked for the whole bill, and part of it was paid since: not the same decision.
    if (expectedCents !== Math.round(reviewedAmount * 100) || orders.length !== request.order_ids.length) {
      return await apiError(paid > 0 ? "apiErr.writeOffPartPaidLater" : "apiErr.writeOffChanged", 409);
    }
    const done = await applyWriteOffRest({
      orders, restaurantId: actor.restaurantId, actorEmail: actor.email, reason: request.reason,
      note: request.note ?? "", expectedCents, currency: orders[0].currency ?? "MXN", requestId: request.id,
    });
    if (done.outcome !== "forgiven") return await apiError(REST_REFUSAL[done.outcome] ?? "apiErr.generic", done.outcome === "failed" ? 500 : 409);
    const lost = (done.forgivenCents + done.writtenOffCents) / 100;
    // The loss is recorded by write_off_remainder_v1 itself, in the same
    // transaction: a log written here could fail after the commit (write-off audit #2).
    return NextResponse.json({ ok: true, approved: true, amount: lost, paid });
  }

  const amount = writeOffTotal(orders);
  // The shown amount, stored ask and current orders must describe one decision.
  if (amount !== reviewedAmount || orders.length !== request.order_ids.length) {
    return await apiError("apiErr.approvalChanged", 409);
  }
  const { data: outcome, error } = await checkoutPageRpc("approve_write_off_request_v2", {
    p_request: request.id, p_restaurant: actor.restaurantId,
    p_actor: actor.email, p_amount: reviewedAmount, p_note: decidedNote || null,
  }, { orderIds: request.order_ids });
  if (error) return await apiError("apiErr.generic", 500);
  // Paid in part since it was asked for: the request stays pending, and the
  // floor collects the rest (paths audit #5).
  if (outcome === "paying") return await apiError("apiErr.writeOffPaying", 409);
  if (outcome === "part_paid") return await apiError("apiErr.writeOffPartPaidLater", 409);
  if (outcome === "split") return await apiError("apiErr.writeOffSplit", 409);
  if (outcome !== "approved") return await apiError("apiErr.approvalChanged", 409);
  await closeSessionsFor(orders, "written_off");

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "bill",
    action: "written_off",
    orderIds: orders.map(o => o.id),
    detail: logDetail({
      table: request.table_label ?? "",
      amount: amount.toFixed(2),
      reason: request.reason,
      requestedBy: request.requested_by,
      note: request.note ?? null,
    }),
    targetEmail: request.requested_by,
  });
  return NextResponse.json({ ok: true, approved: true, amount });
}
