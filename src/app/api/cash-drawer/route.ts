import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingManager, actingStaff } from "@/lib/api-guard";
import { HOLDS_THE_DRAWER } from "@/lib/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { cashAmount, cashNote } from "@/lib/cash-drawer";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

export const runtime = "nodejs";

// POST /api/cash-drawer — the drawer's opening balance, or money taken out.
//
// { kind: "opening", amount }            what the day starts with
// { kind: "withdrawal", amount, note? }  cash taken out of the drawer
//
// The people who run the drawer: owner, manager, cashier. Neither is a sale,
// so neither touches `payments`; the register close reads them to say what
// the drawer should hold.
export async function POST(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor || !HOLDS_THE_DRAWER(actor.role)) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{ kind?: unknown; amount?: unknown; note?: unknown }>(req);
  const kind = body?.kind;
  if (kind !== "opening" && kind !== "withdrawal") return await apiError("apiErr.invalidRequest", 400);
  const amount = cashAmount(body?.amount, kind === "withdrawal");
  if (amount === null) return await apiError("apiErr.cashAmount", 400);
  const note = kind === "withdrawal" ? cashNote(body?.note) : null;

  const { data, error } = await createAdminClient()
    .from("cash_movements")
    .insert({ restaurant_id: actor.restaurantId, kind, amount, note, actor_email: actor.email })
    .select("id")
    .single();
  if (error || !data) return await apiError("apiErr.generic", 500);

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "cash",
    action: kind === "opening" ? "updated" : "created",
    detail: logDetail(kind === "opening" ? { opening: amount.toFixed(2) } : { withdrawal: amount.toFixed(2), note }),
  });
  return NextResponse.json({ ok: true, id: data.id });
}

// DELETE /api/cash-drawer — strike off a withdrawal written by mistake.
//
// A manager's alone: a cashier who could erase what they took out of the
// drawer would make the record worth nothing. Only this restaurant's, and
// only a withdrawal — an opening is corrected by setting it again.
export async function DELETE(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: unknown }>(req);
  const id = typeof body?.id === "string" ? body.id : null;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return await apiError("apiErr.invalidRequest", 400);

  const { data, error } = await createAdminClient()
    .from("cash_movements")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId)
    .eq("kind", "withdrawal")
    .select("amount, note");
  if (error) return await apiError("apiErr.generic", 500);
  if (!data?.length) return await apiError("apiErr.cashMovementNotFound", 404);

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "cash",
    action: "deleted",
    detail: logDetail({ withdrawal: Number(data[0].amount).toFixed(2), note: data[0].note }),
  });
  return NextResponse.json({ ok: true });
}
