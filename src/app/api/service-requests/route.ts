import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

// POST /api/service-requests — a customer at a table asks for a waiter or the
// bill. No login (they scanned a QR); we validate the table server-side and
// insert with the secret key, so the client key can't write this table at all.
export async function POST(req: NextRequest) {
  // A table needs only a handful of calls a minute; block spam past that.
  if (await isRateLimited(`service:${clientIp(req)}`, 8, 60)) {
    return await apiError("apiErr.tooManyWait", 429);
  }

  const { restaurantId, tableId, kind } = await req.json();

  if (!restaurantId || !tableId || (kind !== "waiter" && kind !== "bill")) {
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

  // Don't stack duplicates: one open request per table+kind is enough.
  const { data: existing } = await admin
    .from("service_requests")
    .select("id")
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
