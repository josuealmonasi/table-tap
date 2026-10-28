import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { tableMember } from "@/lib/table-membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKey, forTheRoom, isRateLimited } from "@/lib/rate-limit";
import { BILL_POLL_MS, perMinute } from "@/lib/poll";
import type { SlotReceiptTarget } from "@/lib/slot-receipt-offer";

export const dynamic = "force-dynamic";

/** A paid part needs its receipt id even after the last part closes the sitting. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const p = req.nextUrl.searchParams;
  const restaurantId = p.get("restaurantId"), tableId = p.get("tableId"), sessionId = p.get("sessionId");
  if (!restaurantId || !tableId || !sessionId) return await apiError("apiErr.invalidRequest", 400);
  if (await isRateLimited(`receipt-payments:${clientKey(req)}`, forTheRoom(perMinute(BILL_POLL_MS)), 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }
  try {
    // Closed is readable by its approved phones, never by the next party.
    const member = await tableMember(req, restaurantId, tableId, sessionId, true);
    if (!member) return await apiError("apiErr.tableJoin", 403);
    const db = createAdminClient();
    const { data: splits, error } = await db.from("bill_splits").select("id, status")
      .eq("restaurant_id", restaurantId).eq("table_id", tableId).eq("session_id", sessionId).eq("model_version", 2);
    if (error || !splits) return await apiError("apiErr.ordersLoad", 503);
    if (!splits.length) return NextResponse.json({ split: false, payments: [] });
    const { data: slots, error: slotError } = await db.from("bill_split_slots").select("payment_id, split_id, share_no")
      .eq("restaurant_id", restaurantId).in("split_id", splits.map(s => s.id)).order("share_no");
    if (slotError || !slots) return await apiError("apiErr.ordersLoad", 503);
    const payments: SlotReceiptTarget[] = [];
    for (const slot of slots) {
      if (!slot.payment_id) continue;
      let receipt = payments.find(p => p.paymentId === slot.payment_id);
      if (!receipt) { receipt = { paymentId: slot.payment_id, splitId: slot.split_id, slots: [] }; payments.push(receipt); }
      receipt.slots.push(slot.share_no);
    }
    return NextResponse.json({ split: payments.length > 0 || splits.some(s => s.status !== "cancelled"), payments });
  } catch { return await apiError("apiErr.ordersLoad", 503); }
}
