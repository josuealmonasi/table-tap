import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { applyWriteOff } from "@/lib/apply-write-off";
import { MANAGES } from "@/lib/membership";
import {
  isWriteOffReason,
  noteProblem,
  writableOff,
  writeOffTotal,
} from "@/lib/write-off";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/bill/write-off — cancel what a table owes, on the record.
 *
 * A table that walks out still has orders attached to it. Somebody has to say
 * so, name why, and be named for saying it — otherwise the money quietly
 * disappears from the takings and the only trace is a shift that came up short.
 *
 * A waiter may ask but not grant. Erasing a debt is the one thing the floor can
 * do with no upper bound on what it costs the owner, so the ask is recorded
 * where it happened and the decision waits for whoever answers for it. The
 * waiter is not sent to find a manager before they can even report it.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { tableId, orderIds, reason, note } = (await req.json().catch(() => ({}))) as {
    tableId?: string;
    orderIds?: string[];
    reason?: string;
    note?: string;
  };
  // A table, or a named set of orders — a counter bill has no table to point
  // at, and it is just as capable of walking out the door.
  const ids = (orderIds ?? []).filter(v => typeof v === "string").slice(0, 100);
  if ((!tableId && ids.length === 0) || !isWriteOffReason(reason)) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const text = String(note ?? "").trim();
  const problem = noteProblem(reason, text);
  if (problem) return await apiError(`writeOff.note.${problem}`, 400);

  const db = createAdminClient();
  // Scoped to the actor's own restaurant, so a table id from elsewhere finds
  // nothing rather than someone else's bill.
  const scoped = db
    .from("orders")
    .select("id, total, paid, written_off, status, table_id, table_label")
    .eq("restaurant_id", actor.restaurantId);
  const { data: rows } = await (tableId ? scoped.eq("table_id", tableId) : scoped.in("id", ids));

  const orders = writableOff((rows ?? []) as Order[]);
  if (orders.length === 0) return await apiError("apiErr.nothingToWriteOff", 409);

  const amount = writeOffTotal(orders);
  const label = orders[0].table_label ?? "";
  const detail = logDetail({
    table: label,
    amount: amount.toFixed(2),
    reason,
    note: text || null,
  });

  // A waiter's ask is recorded and stops there — the table still owes.
  if (!MANAGES(actor.role)) {
    const { error } = await db.from("write_off_requests").insert({
      restaurant_id: actor.restaurantId,
      table_id: tableId ?? orders[0].table_id ?? null,
      table_label: label,
      order_ids: orders.map(o => o.id),
      amount,
      reason,
      note: text || null,
      requested_by: actor.email,
    });
    if (error) return await apiError("apiErr.generic", 500);
    await logEvent({
      restaurantId: actor.restaurantId,
      actor: actor.email,
      entity: "bill",
      action: "requested",
      detail,
    });
    return NextResponse.json({ pending: true, amount });
  }

  const done = await applyWriteOff({
    orders,
    restaurantId: actor.restaurantId,
    actorEmail: actor.email,
    reason,
    note: text,
  });
  if (!done) return await apiError("apiErr.generic", 500);

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "bill",
    action: "written_off",
    detail,
  });
  return NextResponse.json({ ok: true, amount });
}
