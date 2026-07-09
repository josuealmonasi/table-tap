import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// POST /api/service-requests — a customer at a table asks for a waiter or the
// bill. No login (they scanned a QR); we validate the table server-side and
// insert with the secret key, so the client key can't write this table at all.
export async function POST(req: NextRequest) {
  const { restaurantId, tableId, kind } = await req.json();

  if (!restaurantId || !tableId || (kind !== "waiter" && kind !== "bill")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const admin = createAdminClient();

  // The table must exist and belong to this restaurant.
  const { data: table } = await admin
    .from("restaurant_tables")
    .select("id, label, restaurant_id")
    .eq("id", tableId)
    .eq("restaurant_id", restaurantId)
    .single();
  if (!table) return NextResponse.json({ error: "Table not found" }, { status: 404 });

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
  if (error) return NextResponse.json({ error: "Could not send request" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
