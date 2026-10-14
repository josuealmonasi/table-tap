import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingStaff } from "@/lib/api-guard";
import { HOLDS_THE_DRAWER, MANAGES } from "@/lib/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { cashAmount } from "@/lib/cash-drawer";
import { shiftDifference, shiftNote } from "@/lib/cash-shift";
import { openShift, shiftSumOf } from "@/lib/cash-shift-server";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

export const runtime = "nodejs";

// POST /api/cash-shift — the cash drawer's shifts.
//
// { action: "open", amount }                 a shift starts with this cash
// { action: "close", counted, confirm: true } the closer counted the drawer
// { action: "explain", id, note }            why a closed shift's count differed
//
// The people who run the drawer: owner, manager, cashier. Closing is a blind
// count: the counted cash is sent before anybody is told what was expected,
// the shift closes on it, and only then does the answer come back. The count
// is final — one adjusted after seeing the answer is not a count.
export async function POST(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor || !HOLDS_THE_DRAWER(actor.role)) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ action?: unknown; amount?: unknown; counted?: unknown; confirm?: unknown; id?: unknown; note?: unknown }>(req);
  const db = createAdminClient();

  if (body?.action === "open") {
    const amount = cashAmount(body.amount, false);
    if (amount === null) return await apiError("apiErr.cashAmount", 400);
    const { data, error } = await db.from("cash_shifts")
      .insert({ restaurant_id: actor.restaurantId, opened_by: actor.email, opening_amount: amount })
      .select("id").single();
    // The one-open-shift index: somebody opened it first.
    if (error?.code === "23505") return await apiError("apiErr.shiftAlreadyOpen", 409);
    if (error || !data) return await apiError("apiErr.generic", 500);
    await logEvent({
      restaurantId: actor.restaurantId, actor: actor.email, entity: "cash", action: "opened",
      detail: logDetail({ opening: amount.toFixed(2) }),
    });
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (body?.action === "close") {
    // The closer signs it off: they counted, and the count is theirs.
    if (body.confirm !== true) return await apiError("apiErr.shiftConfirm", 400);
    const counted = cashAmount(body.counted, false);
    if (counted === null) return await apiError("apiErr.cashAmount", 400);
    const shift = await openShift(actor.restaurantId);
    if (!shift) return await apiError("apiErr.noOpenShift", 409);
    const closedAt = new Date();
    const sum = await shiftSumOf(actor.restaurantId, shift, closedAt);
    const difference = shiftDifference(counted, sum.expected);
    // Only the shift still open: two people closing at once close it once.
    const { data, error } = await db.from("cash_shifts")
      .update({
        closed_by: actor.email, closed_at: closedAt.toISOString(),
        counted_cash: counted, expected_cash: sum.expected, difference,
      })
      .eq("id", shift.id).eq("restaurant_id", actor.restaurantId).is("closed_at", null)
      .select("id");
    if (error) return await apiError("apiErr.generic", 500);
    if (!data?.length) return await apiError("apiErr.noOpenShift", 409);
    await logEvent({
      restaurantId: actor.restaurantId, actor: actor.email, entity: "cash", action: "closed",
      detail: logDetail({ counted: counted.toFixed(2), expected: sum.expected.toFixed(2), difference: difference.toFixed(2) }),
    });
    return NextResponse.json({ ok: true, id: shift.id, ...sum, counted, difference });
  }

  if (body?.action === "explain") {
    const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
    const note = shiftNote(body.note);
    if (!id || !note) return await apiError("apiErr.shiftNote", 400);
    // The person who closed it, or a manager — and only once: an explanation
    // rewritten later is not the one given at the time.
    let write = db.from("cash_shifts").update({ difference_note: note, explained_by: actor.email })
      .eq("id", id).eq("restaurant_id", actor.restaurantId)
      .not("closed_at", "is", null).neq("difference", 0).is("difference_note", null);
    if (!MANAGES(actor.role)) write = write.eq("closed_by", actor.email);
    const { data, error } = await write.select("id");
    if (error) return await apiError("apiErr.generic", 500);
    if (!data?.length) return await apiError("apiErr.shiftNotExplainable", 409);
    await logEvent({
      restaurantId: actor.restaurantId, actor: actor.email, entity: "cash", action: "updated",
      detail: logDetail({ explained: note }),
    });
    return NextResponse.json({ ok: true });
  }

  return await apiError("apiErr.invalidRequest", 400);
}
