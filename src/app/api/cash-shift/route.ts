import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingStaff } from "@/lib/api-guard";
import { HOLDS_THE_DRAWER, MANAGES } from "@/lib/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { cashAmount } from "@/lib/cash-drawer";
import { shiftNote } from "@/lib/cash-shift";
import { uuidOf } from "@/lib/costs/guard";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

export const runtime = "nodejs";

// POST /api/cash-shift — the cash drawer's shifts.
//
// { action: "open", amount }                 a shift starts with this cash
// { action: "close", shiftId, ref, counted, confirm: true } the closer counted this drawer
// { action: "explain", id, note }            why a closed shift's count differed
//
// The people who run the drawer: owner, manager, cashier. Closing is a blind
// count: the counted cash is sent before anybody is told what was expected,
// the shift closes on it, and only then does the answer come back. The count
// is final — one adjusted after seeing the answer is not a count.
export async function POST(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor || !HOLDS_THE_DRAWER(actor.role)) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ action?: unknown; amount?: unknown; counted?: unknown; confirm?: unknown; id?: unknown; note?: unknown; ref?: unknown; shiftId?: unknown }>(req);
  const db = createAdminClient();

  if (body?.action === "open") {
    const amount = cashAmount(body.amount, false);
    if (amount === null) return await apiError("apiErr.cashAmount", 400);
    // Under the money lock, stamped after it: a shift opened while another was
    // closing cannot start before that one ended (paths audit #6).
    const { data: id, error } = await db.rpc("open_cash_shift", {
      p_restaurant: actor.restaurantId, p_actor: actor.email, p_amount: amount,
    });
    // Somebody opened it first (the one-open-shift index says the same).
    if (!error && !id) return await apiError("apiErr.shiftAlreadyOpen", 409);
    if (error?.code === "23505") return await apiError("apiErr.shiftAlreadyOpen", 409);
    if (error) return await apiError("apiErr.generic", 500);
    await logEvent({
      restaurantId: actor.restaurantId, actor: actor.email, entity: "cash", action: "opened",
      detail: logDetail({ opening: amount.toFixed(2) }),
    });
    return NextResponse.json({ ok: true, id });
  }

  if (body?.action === "close") {
    // The closer signs it off: they counted, and the count is theirs.
    if (body.confirm !== true) return await apiError("apiErr.shiftConfirm", 400);
    const counted = cashAmount(body.counted, false);
    if (counted === null) return await apiError("apiErr.cashAmount", 400);
    const shiftId = uuidOf(body.shiftId);
    const ref = uuidOf(body.ref);
    if (!shiftId || !ref) return await apiError("apiErr.shiftChanged", 409);
    // Only the shift still open: two people closing at once close it once.
    // The sum and the signature belong to one transaction, after every earlier
    // money writer and before another withdrawal can change the drawer.
    const { data, error } = await db.rpc("close_cash_shift_once", {
      p_ref: ref,
      p_restaurant: actor.restaurantId, p_shift: shiftId, p_counted: counted, p_actor: actor.email,
    });
    if (error?.code === "PT409") return await apiError("apiErr.retryConflict", 409);
    if (error) return await apiError("apiErr.generic", 500);
    if (!data) return await apiError("apiErr.shiftChanged", 409);
    await logEvent({
      operationKey: `shift:${shiftId.toLowerCase()}`,
      restaurantId: actor.restaurantId, actor: actor.email, entity: "cash", action: "closed",
      detail: logDetail({ counted: counted.toFixed(2), expected: Number(data.expected).toFixed(2),
        difference: Number(data.difference).toFixed(2), currency: data.currency }),
    });
    return NextResponse.json({ ok: true, ...data });
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
