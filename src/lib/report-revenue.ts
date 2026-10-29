import type { ReturnComponents } from "@/lib/return-components";
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
export function lineRevenues(order: RevenueOrder): number[] {
  const values = (Array.isArray(order.items) ? order.items : []).map(lineValue);
  const before = values.reduce((s, v) => s + v, 0);
  if (before <= 0) return values.map(() => 0);
  const cents = Math.round(foodRevenue(order) * 100);
  const exact = values.map(v => cents * v / before);
  const shares = exact.map(Math.floor);
  const ranked = exact.map((v, i) => ({ i, remainder: v - shares[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const left = cents - shares.reduce((s, v) => s + v, 0);
  for (const { i } of ranked.slice(0, left)) shares[i]++;
  return shares.map(v => v / 100);
}
