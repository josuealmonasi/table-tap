import { readReturnAdjustments, returnComponents, verifyReturnedOrder } from "@/lib/return-components";
import { readReceiptReturns } from "@/lib/receipt-return-source";
import { slotReceiptReturns } from "@/lib/slot-receipt-returns";
import { sealSlotVersion, openSlotVersion, sealReceiptVersion, openReceiptVersion } from "@/lib/receipt-version";
import { receiptCents as cents } from "@/lib/receipt-amount";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { ReceiptForgiveness, ReceiptOrder, ReceiptVersion, SlotReceiptPayment } from "@/lib/receipt";

type Database = ReturnType<typeof createAdminClient>;
interface StoredOrder extends ReceiptOrder { restaurant_id: string; table_id: string | null; paid: boolean }
interface Adjustment extends ReceiptForgiveness { restaurant_id: string; order_id: string; currency: string }
export interface ReceiptSource {
  orders: ReceiptOrder[];
  restaurantId: string;
  tableId: string | null;
  version?: ReceiptVersion;
  payment?: SlotReceiptPayment;
}
export class ReceiptReadError extends Error {
  constructor(public status: number) { super("Could not read the receipt"); }
}

/** Select only a known version of the bill; never take financial values from the phone. */
async function orderVersion(db: Database, orders: StoredOrder[], version: ReceiptVersion | undefined): Promise<ReceiptSource> {
  if (version?.returnCopy !== undefined) {
    const saved = openReceiptVersion(version.returnCopy, orders[0].restaurant_id, orders);
    if (!saved) throw new ReceiptReadError(404);
    return { orders: saved, restaurantId: orders[0].restaurant_id, tableId: orders[0].table_id, version };
  }
  const returns = await readReturnAdjustments(db, orders[0].restaurant_id, orders.map(o => o.id));
  const restored = orders.map(order => {
    const matching = returns.filter(a => a.order_id === order.id);
    if (matching.some(a => a.currency !== order.currency)) throw new ReceiptReadError(503);
    if (!matching.length) return order;
    verifyReturnedOrder(order, matching);
    const components = returnComponents(matching);
    return { ...order, total: (cents(order.total) + cents(components.total)) / 100,
      tip: (cents(order.tip ?? 0) + cents(components.tip)) / 100,
      service_fee: (cents(order.service_fee ?? 0) + cents(components.service_fee)) / 100 };
  });
  const { data, error } = await db.from("order_adjustments")
    .select("id, restaurant_id, order_id, currency, previous_total, resulting_total, forgiven, previous_tip, resulting_tip, previous_service_fee, resulting_service_fee")
    .eq("restaurant_id", orders[0].restaurant_id).eq("kind", "forgive").in("order_id", orders.map(o => o.id));
  if (error || !data) throw new ReceiptReadError(503);
  const adjustments = data as Adjustment[];
  const ids = version?.adjustmentIds ?? adjustments.map(a => a.id).sort();
  if (!Array.isArray(ids) || ids.length > orders.length || ids.some(id => typeof id !== "string" || !adjustments.some(a => a.id === id))
    || new Set(ids).size !== ids.length) throw new ReceiptReadError(404);
  let result: ReceiptOrder[] = restored.map(order => {
    const matching = adjustments.filter(a => a.order_id === order.id);
    if (matching.length > 1) throw new ReceiptReadError(503);
    const a = matching[0];
    if (!a) return order;
    const amounts = [a.previous_total, a.resulting_total, a.forgiven, a.previous_tip, a.resulting_tip,
      a.previous_service_fee, a.resulting_service_fee];
    if (amounts.some(value => value == null || !Number.isFinite(Number(value)) || Number(value) < 0)
      || a.restaurant_id !== order.restaurant_id || a.currency !== order.currency
      || cents(a.resulting_total) !== cents(order.total) || cents(a.resulting_tip) !== cents(order.tip ?? 0)
      || cents(a.resulting_service_fee) !== cents(order.service_fee ?? 0)
      || cents(a.previous_tip) + cents(a.previous_service_fee) > cents(a.previous_total)
      || cents(a.resulting_tip) + cents(a.resulting_service_fee) > cents(a.resulting_total)
      || cents(a.forgiven) <= 0 || cents(a.previous_total) - cents(a.resulting_total) !== cents(a.forgiven)) throw new ReceiptReadError(503);
    if (ids.includes(a.id)) return { ...order, forgiveness: a };
    // A copy issued before forgiveness keeps its original fee and tip too.
    return { ...order, total: a.previous_total, tip: a.previous_tip, service_fee: a.previous_service_fee };
  });
  const receiptVersion: ReceiptVersion = { adjustmentIds: ids };
  if (!version && returns.length) {
    result = await readReceiptReturns(db, orders[0].restaurant_id, result, returns);
    receiptVersion.returnCopy = sealReceiptVersion(orders[0].restaurant_id, result);
  }
  return { orders: result, restaurantId: orders[0].restaurant_id, tableId: orders[0].table_id, version: receiptVersion };
}

export async function readOrderReceipt(db: Database, ids: string[], printing: boolean, orderIds: unknown, version?: ReceiptVersion): Promise<ReceiptSource> {
  const { data: found, error: readError } = await db
    .from("orders")
    .select(
      "id, restaurant_id, table_id, items, subtotal, discount, service_fee, tip, total, currency, table_label, created_at, pay_method, paid",
    )
    .in("id", ids)
    .order("created_at", { ascending: true });
  // A failed read is not "no such order".
  if (readError) throw new ReceiptReadError(503);

  // Knowing the order's unguessable id is what proves this is your order —
  // the same trust boundary the tracker already uses.
  // One receipt is one restaurant's bill. Ids from two restaurants would
  // otherwise be added together and sent out under whichever name came first.
  const first = found?.[0];
  const orders = (found ?? []).filter(o => o.restaurant_id === first?.restaurant_id) as StoredOrder[];
  if (orders.length === 0) throw new ReceiptReadError(404);
  const order = orders[0];
  // One receipt, one currency, by email as on paper (paths audit #8): MX$100
  // and US$10 from the same restaurant were added up and sent as MX$110.
  if (orders.some(o => o.currency !== order.currency)) throw new ReceiptReadError(404);
  // Paper confirms a complete paid bill. A partial read or mixed currency
  // cannot become a plausible-looking total on a saved receipt.
  if (printing && (orders.length !== new Set(ids).size || (Array.isArray(orderIds) && orderIds.length > 40)
    || orders.some(o => !o.paid || o.currency !== order.currency || o.table_id !== order.table_id))) {
    throw new ReceiptReadError(404);
  }
  return orderVersion(db, orders, version);
}

/** A slot receipt names money received, even while the other parts are unpaid. */
export async function readSlotReceipt(db: Database, id: string, restaurantId?: string, version?: ReceiptVersion): Promise<ReceiptSource> {
  let query = db.from("payments")
    .select("id, restaurant_id, session_id, amount, tip, currency, created_at").eq("id", id);
  if (restaurantId) query = query.eq("restaurant_id", restaurantId);
  const { data: payment, error } = await query.maybeSingle();
  if (error) throw new ReceiptReadError(503);
  if (!payment) throw new ReceiptReadError(404);
  const { data: slots, error: slotError } = await db.from("bill_split_slots")
    .select("share_no, amount_cents, split_id, restaurant_id").eq("payment_id", id).order("share_no");
  if (slotError) throw new ReceiptReadError(503);
  if (!slots?.length) throw new ReceiptReadError(404);
  const { data: split, error: splitError } = await db.from("bill_splits")
    .select("id, restaurant_id, table_id, session_id, model_version, currency")
    .eq("id", slots[0].split_id).eq("restaurant_id", payment.restaurant_id).maybeSingle();
  if (splitError) throw new ReceiptReadError(503);
  if (!split || split.model_version !== 2 || split.session_id !== payment.session_id || split.currency !== payment.currency
    || slots.some(s => s.restaurant_id !== payment.restaurant_id || s.split_id !== split.id)) throw new ReceiptReadError(404);
  const frozen = slots.reduce((sum, s) => sum + s.amount_cents, 0);
  const charged = cents(payment.amount), tip = cents(payment.tip);
  // The charge adds only the new tip. The full receipt tip can also include
  // old gratuities inside the parts, so principal must never exceed the parts.
  if (!Number.isSafeInteger(charged) || charged <= 0 || tip < 0 || tip > charged || frozen > charged
    || charged - tip > frozen || slots.some(s => !Number.isInteger(s.share_no) || s.share_no < 0 || s.share_no > 19
      || !Number.isSafeInteger(s.amount_cents) || s.amount_cents <= 0)
    || new Set(slots.map(s => s.share_no)).size !== slots.length) throw new ReceiptReadError(503);
  let receipt: SlotReceiptPayment = { ...payment, slots: slots.map(s => s.share_no).sort((a, b) => a - b) };
  if (version?.slotCopy !== undefined) {
    const saved = openSlotVersion(version.slotCopy, payment.restaurant_id, receipt);
    if (!saved) throw new ReceiptReadError(404);
    receipt = saved;
  } else if (version === undefined) receipt = await slotReceiptReturns(db, payment.restaurant_id, receipt);
  else if (version.returnCopy || !Array.isArray(version.adjustmentIds) || version.adjustmentIds.length) throw new ReceiptReadError(404);
  const issued = version ?? { adjustmentIds: [], ...(receipt.returns?.length ? { slotCopy: sealSlotVersion(payment.restaurant_id, receipt) } : {}) };
  return { orders: [], restaurantId: payment.restaurant_id, tableId: split.table_id, payment: receipt, version: issued };
}
