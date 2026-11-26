import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { tableMember } from "@/lib/table-membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKey, forTheRoom, isRateLimited } from "@/lib/rate-limit";
import { BILL_POLL_MS, perMinute } from "@/lib/poll";
import type { SlotReceiptTarget } from "@/lib/slot-receipt-offer";
import { receiptPaymentOwners } from "@/lib/receipt-payment-owners";

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
    // bill_splits has no table column: a split belongs to its sitting, and the
    // membership check above already tied that sitting to this table.
    const { data: splits, error } = await db.from("bill_splits").select("id, status, order_ids")
      .eq("restaurant_id", restaurantId).eq("session_id", sessionId).eq("model_version", 2);
    if (error || !splits) return await apiError("apiErr.ordersLoad", 503);
    if (!splits.length) return NextResponse.json({ split: false, splitOrderIds: [], payments: [] });
    const { data: slots, error: slotError } = await db.from("bill_split_slots").select("payment_id, split_id, share_no")
      .eq("restaurant_id", restaurantId).in("split_id", splits.map(s => s.id)).order("share_no");
    if (slotError || !slots) return await apiError("apiErr.ordersLoad", 503);
    const paymentIds = [...new Set(slots.map(s => s.payment_id).filter(Boolean))];
    const { data: ledger, error: paymentError } = paymentIds.length
      ? await db.from("payments").select("id, order_id, stripe_payment_intent")
        .eq("restaurant_id", restaurantId).eq("session_id", sessionId).in("id", paymentIds)
      : { data: [], error: null };
    if (paymentError || !ledger) return await apiError("apiErr.ordersLoad", 503);
    const owners = await receiptPaymentOwners(db, restaurantId, ledger.map(p => p.stripe_payment_intent));
    const owned = new Map(ledger.map(p => [p.id, owners.get(p.stripe_payment_intent)]));
    const paidSplits = new Set(slots.filter(s => s.payment_id).map(s => s.split_id));
    const payments: SlotReceiptTarget[] = [];
    for (const slot of slots) {
      const owner = owned.get(slot.payment_id);
      if (!owner || owner.payer_member_id !== member.id || owner.split_id !== slot.split_id) continue;
      let receipt = payments.find(p => p.paymentId === slot.payment_id);
      if (!receipt) { receipt = { paymentId: slot.payment_id, splitId: slot.split_id, slots: [] }; payments.push(receipt); }
      receipt.slots.push(slot.share_no);
    }
    // A completed split still owns its order receipts, but not the next round.
    const covered = [...new Set(splits.filter(s => s.status !== "cancelled"
      || paidSplits.has(s.id)).flatMap(s => (s.order_ids ?? []) as string[]))];
    // An order id is the public tracker's whole credential, so name only the
    // orders this phone could already read: the ones it placed, and the ones
    // its own payments were recorded against. Never the rest of the party's.
    const paidByMe = ledger.filter(p => owners.get(p.stripe_payment_intent)?.payer_member_id === member.id)
      .map(p => p.order_id).filter(Boolean);
    const placed = await ordersPlacedBy(db, restaurantId, sessionId, member.id, covered);
    if (!placed) return await apiError("apiErr.ordersLoad", 503);
    const readable = new Set([...placed, ...paidByMe]);
    const splitOrderIds = covered.filter(id => readable.has(id));
    return NextResponse.json({ split: splits.some(s => ["proposed", "locked"].includes(s.status)), splitOrderIds, payments });
  } catch { return await apiError("apiErr.ordersLoad", 503); }
}

async function ordersPlacedBy(
  db: ReturnType<typeof createAdminClient>, restaurantId: string, sessionId: string, memberId: string, ids: string[],
): Promise<string[] | null> {
  if (!ids.length) return [];
  const { data, error } = await db.from("orders").select("id")
    .eq("restaurant_id", restaurantId).eq("session_id", sessionId).eq("diner", memberId).in("id", ids);
  return error || !data ? null : data.map(o => o.id as string);
}
