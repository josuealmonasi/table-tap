import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSplit } from "@/lib/split-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Agreeing to a split.
 *
 * The last person in freezes it, and the amount frozen is what the table owes
 * at that instant — summed from its own orders inside the transaction.
 * `join_bill_split` does the seat-taking and the locking in one statement while
 * holding the row, so two people tapping at once cannot take the same seat or
 * each freeze a different total.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRoomLimited(req, "splitjoin", 20)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const body = await jsonBody<{
    splitId?: string; sessionId?: string; diner?: string; restaurantId?: string; tableId?: string;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { splitId, sessionId, diner, restaurantId, tableId } = body;
  if (await isTableLimited(req, "splitjoin", tableId, 20)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }
  if (!splitId || !sessionId || !diner || !restaurantId || !tableId) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const db = createAdminClient();
  const { data: seat, error } = await db.rpc("join_bill_split", {
    p_split: splitId,
    p_diner: diner,
    p_restaurant: restaurantId,
    p_table: tableId,
    p_session: sessionId,
  });
  // Null means there was no seat: full, called off, or already frozen.
  if (error || seat === null) return await apiError("apiErr.splitFull", 409);

  return NextResponse.json({
    split: await currentSplit(sessionId, diner, restaurantId, tableId),
  });
}
