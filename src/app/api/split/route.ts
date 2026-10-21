import { tableMember } from "@/lib/table-membership";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { staffOpenedBill } from "@/lib/table-session";
import { clientKey, forTheRoom, isRateLimited, isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { SPLIT_POLL_MS, perMinute } from "@/lib/poll";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSplit } from "@/lib/split-service";
import { MAX_SHARES } from "@/lib/split-shares";
import { tableParty } from "@/lib/table-party-server";
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
 * The cookie proves approved membership of this sitting. Its id alone proves
 * nothing. Nothing here trusts an amount from the browser — what is owed is
 * always summed from the orders.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const p = req.nextUrl.searchParams;
  const [sessionId, restaurantId, tableId] = [
    p.get("sessionId"), p.get("restaurantId"), p.get("tableId"),
  ];
  if (!sessionId || !restaurantId || !tableId) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  // Polled by every phone in a split, and one address is the whole room: at 60
  // a minute, one table of six dividing its bill on the Wi-Fi ran it out.
  if (await isRateLimited(`split:${clientKey(req)}`, forTheRoom(perMinute(SPLIT_POLL_MS)), 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  const member = await tableMember(req, restaurantId, tableId, sessionId).catch(() => null);
  if (!member) return await apiError("apiErr.tableJoin", 403);
  const diner = member.id;

  // What this phone says it ordered. Checked against the sitting before it
  // counts for anything — it decides what THEY pay, never what anyone else does.
  const own = (p.get("own") ?? "").split(",").map(x => x.trim()).filter(Boolean);
  const split = await currentSplit(sessionId, diner, restaurantId, tableId, own, member);
  return NextResponse.json({ split, diner });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRoomLimited(req, "splitnew", 10)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const body = await jsonBody<{
    sessionId?: string; diner?: string; restaurantId?: string; tableId?: string; shares?: number;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { sessionId, restaurantId, tableId, shares } = body;
  if (await isTableLimited(req, "splitnew", tableId, 10)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }
  if (!sessionId || !restaurantId || !tableId) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  if (!Number.isInteger(shares) || (shares as number) < 2 || (shares as number) > MAX_SHARES) {
    return await apiError("apiErr.splitPeople", 400);
  }

  const member = await tableMember(req, restaurantId, tableId, sessionId).catch(() => null);
  if (!member) return await apiError("apiErr.tableJoin", 403);
  const diner = member.id;

  // Nothing to divide: the waiter who opened this bill is the one collecting
  // it, and they have a calculator that does the same job at the table.
  const waiterSettles = await staffOpenedBill(restaurantId, tableId, sessionId).catch(() => null);
  if (waiterSettles === null) return await apiError("apiErr.verifyOrders", 503);
  if (waiterSettles) return await apiError("apiErr.waiterSettles", 409);

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

  // Never more shares than there are people eating. A share is claimed by the
  // device that ordered, so one nobody can claim freezes the bill for
  // everybody: the diner who proposed twelve, alone at Mesa 10, could not pay
  // at all until the proposal was called off. The screen caps the dropdown;
  // this is the rule, because a dropdown is not a guard.
  const party = await tableParty(restaurantId, tableId, sessionId);
  if (party < 2 || (shares as number) > party) {
    return await apiError("apiErr.splitTooMany", 409, { n: party });
  }

  // Nothing to divide is not a split, it is a bill that is already settled.
  const orders = await fetchTableBill(restaurantId, tableId, "diner", sessionId, member);
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
  // With the arguments of the old function this call failed unread, and the
  // proposer was left without a seat until they joined their own split.
  const { error: seatError } = await db.rpc("join_bill_split_v2", {
    p_split: made.id,
    p_diner: diner,
    p_restaurant: restaurantId,
    p_table: tableId,
    p_session: sessionId,
  });
  if (seatError) {
    await db.from("bill_splits").update({ status: "cancelled" }).eq("id", made.id).eq("status", "proposed");
    return await apiError("apiErr.generic", 500);
  }

  return NextResponse.json({
    split: await currentSplit(sessionId, diner, restaurantId, tableId, [], member),
  });
}

/** Calling it off — the proposer, or anybody at the table who will not join. */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const body = await jsonBody<{
    splitId?: string; sessionId?: string; diner?: string; restaurantId?: string; tableId?: string;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { splitId, sessionId, restaurantId, tableId } = body;
  if (!splitId || !sessionId || !restaurantId || !tableId) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  // Limited like proposing one: every call reaches the database with the
  // secret key, and nothing else here slowed a script down.
  if (await isRoomLimited(req, "splitend", 10) || await isTableLimited(req, "splitend", tableId, 10)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const member = await tableMember(req, restaurantId, tableId, sessionId).catch(() => null);
  if (!member) return await apiError("apiErr.tableJoin", 403);
  const diner = member.id;

  const db = createAdminClient();
  // Only while it is still a proposal: once it has frozen, people are paying
  // against it and pulling it out from under them would be worse than useless.
  const { data: killed } = await db
    .from("bill_splits")
    .update({ status: "cancelled" })
    .eq("id", splitId)
    .eq("restaurant_id", restaurantId)
    .eq("session_id", sessionId)
    .eq("status", "proposed")
    .select("id");
  if (!killed?.length) return await apiError("apiErr.splitLocked", 409);

  return NextResponse.json({
    split: await currentSplit(sessionId, diner, restaurantId, tableId, [], member),
  });
}
