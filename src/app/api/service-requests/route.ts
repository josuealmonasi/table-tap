import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { getPlan } from "@/lib/plan-server";
import { can } from "@/lib/plan";

export const runtime = "nodejs";

// POST /api/service-requests — a customer at a table asks for a waiter or the
// bill. No login (they scanned a QR); we validate the table server-side and
// insert with the secret key, so the client key can't write this table at all.
export async function POST(req: NextRequest) {
  // A table needs only a handful of calls a minute; block spam past that.
  if (await isRoomLimited(req, "service", 8)) {
    return await apiError("apiErr.tooManyWait", 429);
  }

  const body = await jsonBody<{
    restaurantId?: string;
    tableId?: string;
    kind?: string;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { restaurantId, tableId, kind } = body;
  if (await isTableLimited(req, "service", tableId, 8)) {
    return await apiError("apiErr.tooManyWait", 429);
  }

  // 'pay' means a table wants to settle in person; the waiter takes cash or a
  // card and marks the orders paid.
  const KINDS = ["waiter", "bill", "pay"];
  if (!restaurantId || !tableId || !kind || !KINDS.includes(kind)) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const admin = createAdminClient();

  // The table must exist and belong to this restaurant.
  const { data: table } = await admin
    .from("restaurant_tables")
    .select("id, label, restaurant_id")
    .eq("id", tableId)
    .eq("restaurant_id", restaurantId)
    .single();
  if (!table) return await apiError("apiErr.tableNotFound", 404);

  // Bill and payment calls collect existing debt even after a downgrade.
  if (kind === "waiter") {
    const plan = await getPlan(restaurantId);
    if (!plan || !can(plan.limits, "dineIn") || !can(plan.limits, "waiterService")) {
      return await apiError("plan.needs.dineIn", 403, { plan: "Servicio" });
    }
  }

  // Don't stack duplicates: one open request per table+kind is enough.
  // Scoped to this restaurant too: matched on the table alone, a row another
  // restaurant's staff had pointed at this table answered "already asked", and
  // this table's call for the bill reached nobody.
  const { data: existing } = await admin
    .from("service_requests")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("table_id", tableId)
    .eq("kind", kind)
    .eq("status", "open")
    .limit(1);
  if (existing?.length) return NextResponse.json({ ok: true, duplicate: true });

  const { error } = await admin.from("service_requests").insert({
    restaurant_id: restaurantId,
    table_id: tableId,
    table_label: table.label,
    kind,
  });
  if (error) return await apiError("apiErr.requestSend", 500);

  return NextResponse.json({ ok: true });
}
