import { canonicalUuid, qrKeyMatches } from "@/lib/table-qr-key";
import { tableMember, type TableMember } from "@/lib/table-membership";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { getPlan } from "@/lib/plan-server";
import { can } from "@/lib/plan";
import { actingStaff } from "@/lib/api-guard";

export const runtime = "nodejs";

const KINDS = ["waiter", "bill", "pay"];

// POST /api/service-requests — a customer at a table asks for a waiter or the
// bill. No login (they scanned a QR); we validate the table server-side and
// insert with the secret key, so the client key can't write this table at all.
export async function POST(req: NextRequest) {
  // A table needs only a handful of calls a minute; block spam past that.
  if (await isRoomLimited(req, "service", 8)) {
    return await apiError("apiErr.tooManyWait", 429);
  }

  const body = await jsonBody<{
    restaurantId?: unknown;
    tableId?: unknown;
    kind?: unknown;
    qrKey?: unknown;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  // Validated and lower-cased before the table is counted: the database
  // matches a UUID in any case, so "ABC…" and "abc…" were one table with two
  // allowances (Codex review bl40, finding 5).
  const restaurantId = canonicalUuid(body.restaurantId);
  const tableId = canonicalUuid(body.tableId);
  const kind = typeof body.kind === "string" ? body.kind : "";
  // 'pay' means a table wants to settle in person; the waiter takes cash or a
  // card and marks the orders paid.
  if (!restaurantId || !tableId || !KINDS.includes(kind)) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  if (await isTableLimited(req, "service", tableId, 8)) {
    return await apiError("apiErr.tooManyWait", 429);
  }

  const admin = createAdminClient();

  // The table must exist and belong to this restaurant.
  const { data: table } = await admin
    .from("restaurant_tables")
    .select("id, qr_key")
    .eq("id", tableId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (!table) return await apiError("apiErr.tableNotFound", 404);

  // Bill and payment calls collect existing debt even after a downgrade.
  if (kind === "waiter") {
    const plan = await getPlan(restaurantId);
    if (!plan || !can(plan.limits, "dineIn") || !can(plan.limits, "waiterService")) {
      return await apiError("plan.needs.dineIn", 403, { plan: "Servicio" });
    }
  }

  // Only a phone in the table's LIVE sitting speaks for it: open, and under
  // the eight-hour limit. A sitting nobody closed kept answering a past
  // guest's "bring the bill" long after the party left (finding 6).
  let member: TableMember | null;
  try { member = await tableMember(req, restaurantId, tableId); }
  catch { return await apiError("apiErr.requestSend", 503); }

  // A raised hand stays available to a phone waiting for admission, but only
  // with the key printed in the table's QR. Renaming or moving the table
  // rotates it, so an old sticker or a saved photo stops summoning staff to
  // the table that record is now (finding 3). Tables printed before the key
  // existed have none, and their stickers keep working until renamed.
  if (kind === "waiter" && !member && !qrKeyMatches(table.qr_key, body.qrKey)) {
    return await apiError("apiErr.tableQrStale", 403);
  }
  // Asking for this sitting's bill or collection requires approved membership.
  if (kind !== "waiter" && !member) return await apiError("apiErr.tableJoin", 403);

  // The duplicate check and the insert are one locked database call, scoped
  // to this restaurant, this table and this sitting: two taps at once wrote
  // two alerts (finding 4), and the last party's open call swallowed the next
  // party's (finding 6). An expired call is no longer on the board and does
  // not count; the SQL uses the same eight hours as `serviceRequestCutoff`.
  const { data, error } = await admin.rpc("raise_service_request_v1", {
    p_restaurant: restaurantId, p_table: tableId, p_kind: kind, p_session: member?.sessionId ?? null,
  });
  const status = (data as { status?: string } | null)?.status;
  if (error || !status) return await apiError("apiErr.requestSend", 500);
  if (status === "no_table") return await apiError("apiErr.tableNotFound", 404);
  if (status === "closed") return await apiError("apiErr.tableJoin", 403);
  return NextResponse.json(status === "duplicate" ? { ok: true, duplicate: true } : { ok: true });
}

// The kitchen sees calls without their table's public bill credential. It
// answers by request id, through a restaurant-scoped write that returns no row.
export async function PATCH(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: unknown }>(req);
  if (typeof body?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const { data, error } = await createAdminClient().from("service_requests")
    .update({ status: "done" }).eq("id", body.id).eq("restaurant_id", actor.restaurantId).select("id");
  if (error) return await apiError("apiErr.requestSend", 500);
  if (!data?.length) return await apiError("apiErr.notFound", 404);
  return NextResponse.json({ ok: true });
}
