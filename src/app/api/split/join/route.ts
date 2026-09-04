import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentSplit, writeShares } from "@/lib/split-service";
import { fetchTableBill } from "@/lib/bill-data";
import { tableBill } from "@/lib/table-bill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Agreeing to a split.
 *
 * The last person in freezes it, and the amount frozen is what the table owes
 * at that instant — summed here from the orders, never sent by the phone.
 * `join_bill_split` does the seat-taking and the locking in one statement while
 * holding the row, so two people tapping at once cannot take the same seat or
 * each freeze a different total.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`splitjoin:${clientIp(req)}`, 20, 60)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const { splitId, sessionId, diner, restaurantId, tableId } = (await req.json()) as {
    splitId?: string; sessionId?: string; diner?: string; restaurantId?: string; tableId?: string;
  };
  if (!splitId || !sessionId || !diner || !restaurantId || !tableId) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  // What it would freeze at, read now so the database has it when the last
  // seat is taken.
  const orders = await fetchTableBill(restaurantId, tableId, "diner", sessionId);
  const outstanding = tableBill(orders, []).total;
  if (outstanding <= 0) return await apiError("apiErr.nothingToSplit", 409);

  const db = createAdminClient();
  const { data: seat, error } = await db.rpc("join_bill_split", {
    p_split: splitId,
    p_diner: diner,
    p_amount: outstanding,
  });
  // Null means there was no seat: full, called off, or already frozen.
  if (error || seat === null) return await apiError("apiErr.splitFull", 409);

  // Once frozen, everyone's amount is written down, so nothing recalculates it
  // later from a bill that has since moved.
  const { data: split } = await db
    .from("bill_splits")
    .select("status, amount, shares")
    .eq("id", splitId)
    .maybeSingle();
  if (split?.status === "locked") {
    await writeShares(splitId, Number(split.amount), split.shares);
  }

  return NextResponse.json({
    split: await currentSplit(sessionId, diner, restaurantId, tableId),
  });
}
