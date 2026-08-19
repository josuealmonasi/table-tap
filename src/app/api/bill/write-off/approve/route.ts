import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingManager } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { applyWriteOff } from "@/lib/apply-write-off";
import { NOTE_MAX, writableOff, writeOffTotal } from "@/lib/write-off";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/bill/write-off/approve — a manager decides on a waiter's request.
 *
 * What gets cancelled is re-read here rather than trusted from the row. Between
 * the ask and the decision the table may have paid, been written off by someone
 * else, or ordered another round — and approving a stale list would either
 * cancel a debt that was already settled or miss the half that arrived since.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { requestId, approve, note } = (await req.json().catch(() => ({}))) as {
    requestId?: string;
    approve?: boolean;
    note?: string;
  };
  if (!requestId) return await apiError("apiErr.invalidRequest", 400);
  const decidedNote = String(note ?? "").trim().slice(0, NOTE_MAX);

  const db = createAdminClient();
  const { data: request } = await db
    .from("write_off_requests")
    .select("id, order_ids, table_label, reason, note, requested_by, status")
    .eq("id", requestId)
    .eq("restaurant_id", actor.restaurantId)
    .eq("status", "pending")
    .maybeSingle();
  if (!request) return await apiError("apiErr.requestGone", 409);

  const decide = async (status: "approved" | "rejected", amount?: number) =>
    await db
      .from("write_off_requests")
      .update({
        status,
        decided_by: actor.email,
        decided_at: new Date().toISOString(),
        decided_note: decidedNote || null,
        ...(amount === undefined ? {} : { amount }),
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

  const { data: rows } = await db
    .from("orders")
    .select("id, total, paid, written_off, status, table_label")
    .eq("restaurant_id", actor.restaurantId)
    .in("id", request.order_ids as string[]);

  const orders = writableOff((rows ?? []) as Order[]);
  if (orders.length === 0) {
    // Settled or already cancelled while the ask was waiting: closing the
    // request is the honest outcome, and nothing is written off twice.
    await decide("rejected", 0);
    return await apiError("apiErr.nothingToWriteOff", 409);
  }

  const amount = writeOffTotal(orders);
  const done = await applyWriteOff({
    orders,
    restaurantId: actor.restaurantId,
    actorEmail: actor.email,
    reason: request.reason,
    note: request.note ?? "",
  });
  if (!done) return await apiError("apiErr.generic", 500);
  await decide("approved", amount);

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "bill",
    action: "written_off",
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
