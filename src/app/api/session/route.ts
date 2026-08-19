import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { unpaidOrders } from "@/lib/table-bill";
import type { Order } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/session?id=<sessionId> — is this phone still sitting somewhere?
 *
 * A phone that has ordered carries the id of its sitting. Before it is allowed
 * to start ordering at a different table, it asks here: if that sitting is
 * still open and still owed for, the diner is at one table with an unpaid bill
 * and is about to open a second one.
 *
 * The id is unguessable and tells the caller only about its own sitting —
 * which table it is at, and how much is left on it. Rate limited because it is
 * open to the world.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return await apiError("apiErr.missingId", 400);
  if (await isRateLimited(`session:${clientIp(req)}`, 60, 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  const db = createAdminClient();
  const { data: session } = await db
    .from("table_sessions")
    .select("id, table_id, closed_at, restaurant_id")
    .eq("id", id)
    .maybeSingle();

  // A sitting that closed leaves nothing behind: the diner is free.
  if (!session || session.closed_at) return NextResponse.json({ open: false });

  const { data: rows } = await db
    .from("orders")
    .select("id, total, paid, written_off, status")
    .eq("session_id", id);

  const owing = unpaidOrders((rows ?? []) as Order[]);
  const owed = Math.round(owing.reduce((sum, o) => sum + Number(o.total), 0) * 100) / 100;

  // Open but paid up is not a reason to hold anybody: the table simply has not
  // been closed yet.
  if (owed <= 0) return NextResponse.json({ open: false });

  const { data: table } = await db
    .from("restaurant_tables")
    .select("label")
    .eq("id", session.table_id)
    .maybeSingle();

  return NextResponse.json({
    open: true,
    tableId: session.table_id,
    tableLabel: (table as { label: string } | null)?.label ?? "",
    owed,
  });
}
