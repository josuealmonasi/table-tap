import { orderItemsWithRevenue } from "@/lib/order-line-revenue";
import type { createAdminClient } from "@/lib/supabase/admin";
import { priceCart } from "@/lib/pricing";
import { promotionsOnSale } from "@/lib/promotions-on-sale";
import { toCartPromos } from "@/lib/promotions";
import { cartReferences, verifyCart, type VerifiableItem } from "@/lib/verify-cart";
import type { OrderLineItem } from "@/lib/types";
import type { OfflineCharge } from "@/lib/offline-sale";
import type { PosSaleBody } from "@/lib/pos-sale";

interface RestaurantPricing { service_pct: number; service_enabled: boolean }

// Today's menu, with "sold out" and "closed" waived, measures the difference
// (`offline_drift`) for a manager to see and requires approval if prices moved.
export async function currentOfflinePrice(db: ReturnType<typeof createAdminClient>, restaurantId: string, body: PosSaleBody, restaurant: RestaurantPricing) {
  // These sales already happened. The till restored lines without checking
  // quantities, and offlineLines still truncates them: today's verification
  // must measure that same sale rather than strand its collected money.
  const items = (body.items ?? []).map(line => ({ ...line, qty: Math.trunc(Number(line.qty)) }));
  const promotions = await promotionsOnSale(db, restaurantId);
  const refs = cartReferences(items, promotions);
  if (!refs.ok) return null;
  const { data, error } = await db.from("menu_items")
    .select("id, name, price, emoji, available, discount_pct, modifiers, category_id, menu_id, is_addon, item_addons!product_id(addon_id), skips_kitchen, categories(station)")
    .in("id", refs.ids).eq("restaurant_id", restaurantId);
  if (error) throw new Error(`Could not check offline prices: ${error.message}`);
  const verified = data ? verifyCart({ items, promotions,
    dbItems: (data as VerifiableItem[]).map(d => ({ ...d, available: true })), isOnOpenMenu: () => true }) : null;
  if (!verified?.ok) return null;
  const price = priceCart({ items: verified.lines, servicePct: restaurant.service_pct, serviceEnabled: restaurant.service_enabled,
    tipPct: Number(body.tipPct) || 0, tipAmount: typeof body.tipAmount === "number" ? body.tipAmount : undefined,
    coupon: null, promos: toCartPromos(promotions) });
  return { price, lines: verified.lines };
}

function linePrice(l: OrderLineItem): unknown {
  return [l.itemId, l.qty, Number(l.price), Number(l.discountPct ?? 0), l.comboId ?? null,
    Object.entries(l.mods ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]),
    (l.extras ?? []).map(e => [e.id, Number(e.price)]).sort(),
    (l.components ?? []).map(c => [c.itemId, c.qty]).sort()];
}

// Sort each normalized line, keeping duplicates: verification puts combos first.
/** Equal totals alone cannot authorize forged prices or a changed combo. */
export function sameOfflinePrice(charge: OfflineCharge, lines: OrderLineItem[], current: Awaited<ReturnType<typeof currentOfflinePrice>>): boolean {
  if (!current) return false;
  const hasSnapshot = lines.some(l => l.promotionRevenue !== undefined);
  const priced = hasSnapshot ? orderItemsWithRevenue(current.lines, current.price) : [];
  const saved = lines.map(l => JSON.stringify([linePrice(l), l.promotionRevenue])).sort();
  const expected = priced.map(l => JSON.stringify([linePrice(l), l.promotionRevenue])).sort();
  // A new receipt cannot redistribute its unchanged total between products.
  // Legacy receipts have no snapshot and keep the legacy reporting fallback.
  return (!hasSnapshot || JSON.stringify(saved) === JSON.stringify(expected)) && (["subtotal", "serviceFee", "tip", "discount", "total"] as const)
    .every(key => Math.round(charge[key] * 100) === Math.round(current.price[key] * 100))
    && JSON.stringify(lines.map(l => JSON.stringify(linePrice(l))).sort()) === JSON.stringify(current.lines.map(l => JSON.stringify(linePrice(l))).sort());
}

/** Keep verified preparation facts, but never invent a historical promotion.
 * Verification may reorder combos, so attach the saved revenue by line identity. */
export function offlineRevenueLines(saved: OrderLineItem[], verified: OrderLineItem[]): OrderLineItem[] {
  const remaining = [...saved];
  return verified.map(line => {
    const index = remaining.findIndex(l => JSON.stringify(linePrice(l)) === JSON.stringify(linePrice(line)));
    const original = index >= 0 ? remaining.splice(index, 1)[0] : undefined;
    return { ...line, ...(original?.promotionRevenue !== undefined ? { promotionRevenue: original.promotionRevenue } : {}) };
  });
}
