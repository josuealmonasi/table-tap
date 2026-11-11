import type { OrderLineItem } from "@/lib/types";
import type { PricedCart } from "@/lib/pricing";
import { receiptCents } from "@/lib/receipt-amount";

/** Freeze item/quantity promotion revenue before any bill-wide coupon.
 * A quantity deal only reduces its own product. Different choices of the same
 * product share its saving by value, in cents; combos are already bundle-priced
 * and their displayed saving must never be deducted a second time. */
export function orderItemsWithRevenue(items: OrderLineItem[], pricing: Pick<PricedCart, "lines" | "promoSavings">): OrderLineItem[] {
  const revenues = pricing.lines.map(l => receiptCents(l.unit * l.qty));
  for (const [itemId, saving] of Object.entries(pricing.promoSavings)) {
    const indices = items.flatMap((l, i) => l.itemId === itemId && !l.comboId ? [i] : []);
    const before = indices.reduce((sum, i) => sum + revenues[i], 0);
    if (before <= 0) continue;
    const retained = Math.max(0, before - receiptCents(saving.saved));
    const exact = indices.map(i => retained * revenues[i] / before);
    const shares = exact.map(Math.floor);
    const ranked = exact.map((v, i) => ({ i, remainder: v - shares[i] }))
      .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
    for (const { i } of ranked.slice(0, retained - shares.reduce((s, v) => s + v, 0))) shares[i]++;
    indices.forEach((i, position) => { revenues[i] = shares[position]; });
  }
  return items.map((line, i) => ({ ...line, promotionRevenue: revenues[i] / 100 }));
}
