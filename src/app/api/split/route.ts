import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSplit } from "@/lib/split-service";
import { fetchTableBill } from "@/lib/bill-data";
import { tableBill } from "@/lib/table-bill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A table dividing its bill.
 *
 * GET  — what is happening, and what this phone owes because of it.
 * POST — propose dividing it N ways.
 *
 * The sitting id is the capability, the same way an order id is on the tracker:
 * unguessable, and useless anywhere but this table. Nothing here trusts an
 * amount from the browser — what is owed is always summed from the orders.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const p = req.nextUrl.searchParams;
  const [sessionId, diner, restaurantId, tableId] = [
    p.get("sessionId"), p.get("diner"), p.get("restaurantId"), p.get("tableId"),
  ];
  if (!sessionId || !diner || !restaurantId || !tableId) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  if (await isRateLimited(`split:${clientIp(req)}`, 60, 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  // What this phone says it ordered. Checked against the sitting before it
  // counts for anything — it decides what THEY pay, never what anyone else does.
  const own = (p.get("own") ?? "").split(",").map(x => x.trim()).filter(Boolean);
  const split = await currentSplit(sessionId, diner, restaurantId, tableId, own);
  return NextResponse.json({ split });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`splitnew:${clientIp(req)}`, 10, 60)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const { sessionId, diner, restaurantId, tableId, shares } = (await req.json()) as {
    sessionId?: string; diner?: string; restaurantId?: string; tableId?: string; shares?: number;
  };
  if (!sessionId || !diner || !restaurantId || !tableId) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  if (!Number.isInteger(shares) || (shares as number) < 2 || (shares as number) > 20) {
    return await apiError("apiErr.splitPeople", 400);
  }

  const db = createAdminClient();

  // The sitting has to be this table's, and open. Otherwise a stale id from a
  // phone that sat here last night could start a split on tonight's diners.
  const { data: sitting } = await db
    .from("table_sessions")
    .select("id, restaurant_id, table_id, closed_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sitting || sitting.closed_at || sitting.restaurant_id !== restaurantId || sitting.table_id !== tableId) {
    return await apiError("apiErr.sessionGone", 409);
  }

  // Nothing to divide is not a split, it is a bill that is already settled.
  const orders = await fetchTableBill(restaurantId, tableId, "diner", sessionId);
  if (tableBill(orders, []).total <= 0) return await apiError("apiErr.nothingToSplit", 409);

  const { data: made, error } = await db
    .from("bill_splits")
    .insert({ restaurant_id: restaurantId, session_id: sessionId, shares, proposed_by: diner })
    .select("id")
    .single();
  // The unique index refuses a second live proposal, which is the point: two
  // people asking at once would divide the same bill twice.
  if (error || !made) return await apiError("apiErr.splitAlready", 409);

  // Whoever asked is in it, and takes seat zero — which carries the odd cent.
  await db.rpc("join_bill_split", { p_split: made.id, p_diner: diner, p_amount: 0 });

  return NextResponse.json({
    split: await currentSplit(sessionId, diner, restaurantId, tableId),
  });
}

/** Calling it off — the proposer, or anybody at the table who will not join. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { splitId, sessionId, diner, restaurantId, tableId } = (await req.json()) as {
    splitId?: string; sessionId?: string; diner?: string; restaurantId?: string; tableId?: string;
  };
  if (!splitId || !sessionId || !diner || !restaurantId || !tableId) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const db = createAdminClient();
  // Only while it is still a proposal: once it has frozen, people are paying
  // against it and pulling it out from under them would be worse than useless.
  const { data: killed } = await db
    .from("bill_splits")
    .update({ status: "cancelled" })
    .eq("id", splitId)
    .eq("session_id", sessionId)
    .eq("status", "proposed")
    .select("id");
  if (!killed?.length) return await apiError("apiErr.splitLocked", 409);

  return NextResponse.json({
    split: await currentSplit(sessionId, diner, restaurantId, tableId),
  });
}
