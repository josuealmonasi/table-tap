import { returnComponents, type ReturnAdjustment, type ReturnComponents } from "@/lib/return-components";
import type { ReturnEvent } from "@/lib/refunds/events";
import { receiptCents as cents } from "@/lib/receipt-amount";
import type { OrderLineItem } from "@/lib/types";
import { itemSalePrice } from "@/lib/pricing";

export interface RevenueOrder {
  items: OrderLineItem[];
  return_components?: ReturnComponents;
  total: number;
  service_fee: number;
  tip: number;
}

/** Final food revenue, including IVA. Subtotal already includes checkout
 * discounts, but a later table discount changes only total. Subtracting the
 * stored discount again would count the checkout discount twice. */
export function foodRevenue(order: RevenueOrder): number {
  return Math.max(0, Math.round((Number(order.total) + Number(order.return_components?.total ?? 0) - Number(order.service_fee)
    - Number(order.return_components?.service_fee ?? 0) - Number(order.tip) - Number(order.return_components?.tip ?? 0)) * 100)) / 100;
}

/** What one line came to before the order's own discounts: its dish's sale price and extras. */
function lineValue(line: OrderLineItem): number {
  const base = line.comboId ? Number(line.price) : itemSalePrice(Number(line.price), line.discountPct);
  const extras = (line.extras ?? []).reduce((s, e) => s + Number(e.price), 0);
  return (base + extras) * line.qty;
}

/** Share discounts by value, with whole cents that add back to the food.
 * Largest remainders get the spare cents, so splitting a line cannot invent
 * revenue and analytics and contribution use exactly the same allocation. */
export function lineRevenues(order: RevenueOrder, food = foodRevenue(order)): number[] {
  const values = (Array.isArray(order.items) ? order.items : []).map(lineValue);
  const before = values.reduce((s, v) => s + v, 0);
  if (before <= 0) return values.map(() => 0);
  const foodCents = cents(food);
  const exact = values.map(v => foodCents * v / before);
  const shares = exact.map(Math.floor);
  const ranked = exact.map((v, i) => ({ i, remainder: v - shares[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const left = foodCents - shares.reduce((s, v) => s + v, 0);
  for (const { i } of ranked.slice(0, left)) shares[i]++;
  return shares.map(v => v / 100);
}

export interface ReturnOperationComponents {
  id: string; adjustment_id: string; currency: string; amount: number; tip: number;
}

/** Attribute the immutable food reduction to its payment operations, then to
 * each dated success. Tips never reduce product revenue. Food/service share
 * principal proportionally. Cumulative integer division keeps earlier cents
 * fixed when another piece succeeds, and a full completion deducts exactly
 * the saved food reduction. This does not change historical sales readers. */
export function returnedFoodCents(adjustment: ReturnAdjustment, operations: ReturnOperationComponents[], events: ReturnEvent[]): Map<string, number> {
  const components = returnComponents([adjustment]);
  const principal = cents(components.total) - cents(components.tip);
  const food = principal - cents(components.service_fee);
  const ops = [...operations].sort((a, b) => a.id.localeCompare(b.id));
  const weights = ops.map(o => cents(o.amount) - cents(o.tip));
  if (food < 0 || ops.some((o, i) => !Number.isSafeInteger(cents(o.amount)) || cents(o.amount) <= 0
    || !Number.isSafeInteger(weights[i]) || weights[i] < 0 || cents(o.tip) < 0)
    || ops.reduce((s, o) => s + cents(o.amount), 0) !== cents(components.total)
    || weights.reduce((s, v) => s + v, 0) !== principal) throw new Error("Could not verify returned food");
  const shares = weights.map(w => principal > 0 ? Number(BigInt(food) * BigInt(w) / BigInt(principal)) : 0);
  const ranked = weights.map((w, i) => ({ i, remainder: principal > 0 ? BigInt(food) * BigInt(w) % BigInt(principal) : BigInt(0) }))
    .sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
  for (const { i } of ranked.slice(0, food - shares.reduce((s, v) => s + v, 0))) shares[i]++;
  const result = new Map<string, number>();
  ops.forEach((o, i) => {
    let completed = 0;
    const pieces = events.filter(e => e.operation_id === o.id)
      .sort((a, b) => Date.parse(a.succeeded_at) - Date.parse(b.succeeded_at) || a.id.localeCompare(b.id));
    for (const e of pieces) {
      const before = completed;
      completed += e.amount_cents;
      if (!Number.isSafeInteger(e.amount_cents) || e.amount_cents <= 0 || completed > cents(o.amount)
        || result.has(e.id) || !Number.isFinite(Date.parse(e.succeeded_at))) throw new Error("Could not verify returned food events");
      result.set(e.id, Number(BigInt(completed) * BigInt(shares[i]) / BigInt(cents(o.amount))
        - BigInt(before) * BigInt(shares[i]) / BigInt(cents(o.amount))));
    }
  });
  return result;
}
