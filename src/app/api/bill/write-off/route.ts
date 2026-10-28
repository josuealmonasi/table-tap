import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { applyWriteOff } from "@/lib/apply-write-off";
import { applyWriteOffRest, coverageByOrder, owedCents, REST_REFUSAL } from "@/lib/write-off-rest";
import { MANAGES } from "@/lib/membership";
import { formatMoney } from "@/lib/format";
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

  const body = await jsonBody<{
    tableId?: string;
    orderIds?: string[];
    reason?: string;
    note?: string;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { tableId, orderIds, reason, note } = body;
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
    .select("id, total, paid, written_off, status, table_id, table_label, currency")
    .is("account_id", null)
    .eq("restaurant_id", actor.restaurantId);
  const { data: rows, error: readError } = await (tableId ? scoped.eq("table_id", tableId) : scoped.in("id", ids));
  // A failed read is not a bill with nothing on it.
  if (readError) return await apiError("apiErr.generic", 503);

  const orders = writableOff((rows ?? []) as Order[]);
  if (orders.length === 0) return await apiError("apiErr.nothingToWriteOff", 409);

  // Part of it is paid: only the rest is lost, so only the rest is written off
  // (write_off_remainder_v1). Forgiving the whole total would report money
  // that came in as lost (paths audit #5).
  const paidBy = await coverageByOrder(actor.restaurantId, orders.map(o => o.id));
  if (paidBy === null) return await apiError("apiErr.generic", 503);
  const paid = Math.round([...paidBy.values()].reduce((a, b) => a + b, 0) * 100) / 100;
  if (paid > 0) {
    return await writeOffTheRest({ actor, orders, paidBy, paid, tableId, reason, note: text });
  }

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
  if (done.outcome === "part_paid") {
    return await apiError("apiErr.writeOffPartPaid", 409, { amount: formatMoney(done.paid, orders[0].currency ?? "MXN") });
  }
  if (done.outcome === "split") return await apiError("apiErr.billSplitLive", 409);
  if (done.outcome === "nothing") return await apiError("apiErr.nothingToWriteOff", 409);
  if (done.outcome === "failed") return await apiError("apiErr.generic", 500);

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "bill",
    action: "written_off",
    orderIds: done.orderIds,
    detail: logDetail({ table: label, amount: done.amount.toFixed(2), reason, note: text || null }),
  });
  return NextResponse.json({ ok: true, amount: done.amount });
}

/**
 * A part-paid table: the waiter asks for the rest, the manager writes it off.
 * Logged as `written_off` with the amount actually lost, so the corte and
 * analytics count it once, the same way as any write-off; the order's own
 * record of what was forgiven is its `order_adjustments` row.
 */
async function writeOffTheRest(p: {
  actor: NonNullable<Awaited<ReturnType<typeof actingFrontOfHouse>>>;
  orders: Order[]; paidBy: Map<string, number>; paid: number;
  tableId: string | undefined; reason: string; note: string;
}): Promise<NextResponse> {
  const { actor, orders, paidBy, paid, reason, note } = p;
  const currency = orders[0].currency ?? "MXN";
  if (orders.some(o => (o.currency ?? "MXN") !== currency)) return await apiError("apiErr.writeOffChanged", 409);
  const expectedCents = owedCents(orders, paidBy);
  const lost = expectedCents / 100;
  const label = orders[0].table_label ?? "";
  const detail = logDetail({ table: label, amount: lost.toFixed(2), paid: paid.toFixed(2), kind: "rest", reason, note: note || null });

  if (!MANAGES(actor.role)) {
    const { error } = await createAdminClient().from("write_off_requests").insert({
      restaurant_id: actor.restaurantId,
      table_id: p.tableId ?? orders[0].table_id ?? null,
      table_label: label,
      order_ids: orders.map(o => o.id),
      amount: lost,
      reason,
      note: note || null,
      requested_by: actor.email,
    });
    if (error) return await apiError("apiErr.generic", 500);
    await logEvent({ restaurantId: actor.restaurantId, actor: actor.email, entity: "bill", action: "requested", detail });
    return NextResponse.json({ pending: true, amount: lost, paid });
  }

  const done = await applyWriteOffRest({
    orders, restaurantId: actor.restaurantId, actorEmail: actor.email, reason, note, expectedCents, currency,
  });
  if (done.outcome !== "forgiven") {
    if (done.outcome === "repeat") return NextResponse.json({ ok: true, amount: done.forgivenCents / 100, paid });
    return await apiError(REST_REFUSAL[done.outcome], done.outcome === "failed" ? 500 : 409);
  }
  const amount = (done.forgivenCents + done.writtenOffCents) / 100;
  // The loss is recorded by write_off_remainder_v1 itself, in the same
  // transaction: a log written here could fail after the commit (write-off audit #2).
  return NextResponse.json({ ok: true, amount, paid });
}

