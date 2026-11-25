import type { NextRequest } from "next/server";
import { actingStaff } from "@/lib/api-guard";
import { ownPaidOrderIds, receiptPaymentOwners } from "@/lib/receipt-payment-owners";
import { tableMember } from "@/lib/table-membership";
import type { createAdminClient } from "@/lib/supabase/admin";

type Database = ReturnType<typeof createAdminClient>;

export interface ReceiptOrderOwner {
  id: string;
  diner: string | null;
  table_id: string | null;
  table_label?: string | null;
  session_id: string | null;
}

export async function canReadOrderReceipt(
  req: NextRequest, db: Database, restaurantId: string, orders: ReceiptOrderOwner[],
): Promise<boolean> {
  const tableOrders = orders.filter(o => o.table_id || o.session_id || o.table_label);
  if (!tableOrders.length) return true; // Counter receipts use their private order link.
  if ((await actingStaff())?.restaurantId === restaurantId) return true;
  const tableId = tableOrders[0].table_id;
  if (!tableId || tableOrders.some(o => !o.session_id || o.table_id !== tableId)
    || tableOrders.length !== orders.length) return false;

  for (const sessionId of new Set(tableOrders.map(o => o.session_id as string))) {
    const member = await tableMember(req, restaurantId, tableId, sessionId, true);
    if (!member) return false;
    const otherIds = tableOrders.filter(o => o.session_id === sessionId && o.diner !== member.id).map(o => o.id);
    const paid = await ownPaidOrderIds(db, restaurantId, sessionId, member.id, otherIds);
    if (otherIds.some(id => !paid.has(id))) return false;
  }
  return true;
}

export async function canReadSlotReceipt(
  req: NextRequest, db: Database, payment: { restaurant_id: string; session_id: string | null; stripe_payment_intent: string | null },
  splitId: string, tableId: string | null,
): Promise<boolean> {
  if ((await actingStaff())?.restaurantId === payment.restaurant_id) return true;
  if (!tableId || !payment.session_id || !payment.stripe_payment_intent) return false;
  const member = await tableMember(req, payment.restaurant_id, tableId, payment.session_id, true);
  if (!member) return false;
  const owners = await receiptPaymentOwners(db, payment.restaurant_id, [payment.stripe_payment_intent]);
  const owner = owners.get(payment.stripe_payment_intent);
  return owner?.payer_member_id === member.id && owner.split_id === splitId;
}
