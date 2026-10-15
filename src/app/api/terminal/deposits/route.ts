import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingManager } from "@/lib/api-guard";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { cashAmount, cashNote } from "@/lib/cash-drawer";
import { decimal } from "@/lib/costs/input";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { readTerminal } from "@/lib/terminal-server";

export const runtime = "nodejs";

// /api/terminal/deposits — the restaurant's own card terminal: what the bank
// deposited for a day's card sales. Owner and managers, on a tier with the till.
//
// POST   { day, received, note? }   a day's deposit arrived: this much
// DELETE { day }                    it was marked wrong: take it back
// PATCH  { settleDays }             how many business days the bank takes
//
// What a day SHOULD deposit is worked out here, from its payments, at the
// moment it is marked, and kept beside what arrived: a figure the browser sent
// would be a figure anybody could choose.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function guard(): Promise<{ restaurantId: string; email: string; timeZone: string } | NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = (await frozenBlocks(actor.restaurantId)) ?? (await planBlocks(actor.restaurantId, "pos"));
  if (blocked) return blocked;
  const { data } = await createAdminClient().from("restaurants").select("timezone").eq("id", actor.restaurantId).single();
  return { restaurantId: actor.restaurantId, email: actor.email, timeZone: data?.timezone ?? DEFAULT_TIME_ZONE };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await guard();
  if (actor instanceof NextResponse) return actor;
  const body = await jsonBody<{ day?: unknown; received?: unknown; note?: unknown }>(req);
  const day = typeof body?.day === "string" && DAY.test(body.day) ? body.day : null;
  if (!day) return await apiError("apiErr.depositDay", 400);
  const received = cashAmount(body?.received, false);
  if (received === null) return await apiError("apiErr.depositAmount", 400);

  const view = await readTerminal(actor.restaurantId, actor.timeZone);
  const row = view.days.find(d => d.day === day);
  if (!row || row.count === 0) return await apiError("apiErr.depositNoSales", 404);

  const { error } = await createAdminClient().from("terminal_deposits").insert({
    restaurant_id: actor.restaurantId, sales_day: day, expected: row.expected, received,
    note: cashNote(body?.note), recorded_by: actor.email,
  });
  if (error?.code === "23505") return await apiError("apiErr.depositMarked", 409);
  if (error) return await apiError("apiErr.generic", 500);
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "terminal", action: "collected",
    detail: logDetail({ note: day, amount: received.toFixed(2) }),
  });
  return NextResponse.json({ ok: true, expected: row.expected, received });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const actor = await guard();
  if (actor instanceof NextResponse) return actor;
  const body = await jsonBody<{ day?: unknown }>(req);
  const day = typeof body?.day === "string" && DAY.test(body.day) ? body.day : null;
  if (!day) return await apiError("apiErr.depositDay", 400);
  const { data, error } = await createAdminClient().from("terminal_deposits")
    .delete().eq("restaurant_id", actor.restaurantId).eq("sales_day", day).select("id");
  if (error) return await apiError("apiErr.generic", 500);
  if (!data?.length) return await apiError("apiErr.notFound", 404);
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "terminal", action: "deleted",
    detail: logDetail({ note: day }),
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const actor = await guard();
  if (actor instanceof NextResponse) return actor;
  const days = decimal((await jsonBody<{ settleDays?: unknown }>(req))?.settleDays, 10, 0);
  if (days === null) return await apiError("apiErr.settleDays", 400);
  const { error } = await createAdminClient().from("restaurants")
    .update({ terminal_settle_days: days }).eq("id", actor.restaurantId);
  if (error) return await apiError("apiErr.generic", 500);
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "terminal", action: "updated",
    detail: logDetail({ note: `${days} d` }),
  });
  return NextResponse.json({ ok: true, settleDays: days });
}
