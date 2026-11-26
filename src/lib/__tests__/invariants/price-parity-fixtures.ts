import type { createAdminClient } from "@/lib/supabase/admin";
import type { CouponRow } from "@/lib/coupon-service";
import type { PromotionWithItems } from "@/lib/promotions";
import type { VerifiableItem } from "@/lib/verify-cart";
import type { OrderLineItem } from "@/lib/types";

/**
 * One menu, one set of promotions and a handful of carts, priced by every
 * path in `price-parity.spec.ts`. Prices are chosen so every figure is a
 * whole number of centavos: a parity failure here is a rule, never rounding.
 */
export const RESTAURANT = "r-parity";

const row = (id: string, price: number, extra: Partial<VerifiableItem> = {}): VerifiableItem => ({
  id, name: id, price, emoji: "", available: true, discount_pct: 0, modifiers: null,
  category_id: null, menu_id: "m-open", is_addon: false, item_addons: [], ...extra,
});

export const MENU: VerifiableItem[] = [
  row("taco", 50, { item_addons: [{ addon_id: "queso" }] }),
  row("queso", 12, { is_addon: true }),
  row("soda", 25),
  row("agua", 20, { discount_pct: 10 }),
  row("burger", 100),
  row("fries", 40),
  row("tostada", 95),
];

const promo = (id: string, sort: number, fields: Partial<PromotionWithItems>, items: string[]): PromotionWithItems => ({
  id, restaurant_id: RESTAURANT, kind: "bogo", name: id, emoji: "", description: null, combo_price: null,
  buy_qty: null, pay_qty: null, tiers: null, active: true, sort_order: sort,
  items: items.map(item_id => ({ item_id, qty: 1 })), ...fields,
});

/** In loader order (sort_order, then id): ties go to the earlier deal. */
export const PROMOTIONS: PromotionWithItems[] = [
  promo("2x1-soda", 1, { buy_qty: 2, pay_qty: 1 }, ["soda"]),
  promo("3x2-taco", 2, { buy_qty: 3, pay_qty: 2 }, ["taco"]),
  // Saves exactly what 3x2 saves on three tacos: the tie.
  promo("3-for-100-taco", 3, { kind: "tiered", tiers: [{ qty: 3, price: 100 }] }, ["taco"]),
  promo("2x1-agua", 4, { buy_qty: 2, pay_qty: 1 }, ["agua"]),
  promo("burger-combo", 5, { kind: "combo", combo_price: 120 }, ["burger", "fries"]),
];

export const coupon = (id: string, kind: "fixed" | "percent", value: number, min = 0): CouponRow => ({
  id, code: id.toUpperCase(), kind, value, min_subtotal: min, max_uses: null, uses_count: 0,
  active: true, starts_at: null, ends_at: null, staff_only: false,
});

/** What a phone sends: ids and quantities, with a forged price the server must ignore. */
const line = (itemId: string, qty: number, extras: string[] = []): OrderLineItem => ({
  itemId, name: itemId, emoji: "", price: 1, qty, mods: {},
  ...(extras.length ? { extras: extras.map(id => ({ id, name: id, emoji: "", price: 0 })) } : {}),
});
const combo: OrderLineItem = {
  itemId: "burger-combo", comboId: "burger-combo", name: "combo", emoji: "", price: 1, qty: 1, mods: {},
  components: [{ itemId: "burger", name: "burger", emoji: "", qty: 1 }, { itemId: "fries", name: "fries", emoji: "", qty: 1 }],
};

export interface ParityCart {
  name: string;
  items: OrderLineItem[];
  servicePct: number;
  tipPct: number;
  coupon: CouponRow | null;
}

const cart = (name: string, items: OrderLineItem[], more: Partial<ParityCart> = {}): ParityCart =>
  ({ name, items, servicePct: 0, tipPct: 0, coupon: null, ...more });

export const CARTS: ParityCart[] = [
  cart("plain items", [line("taco", 1), line("burger", 2)]),
  cart("an item with an extra", [line("taco", 2, ["queso"])]),
  cart("a 2x1 promotion", [line("soda", 2), line("taco", 1)]),
  cart("a 3x2 tie", [line("taco", 3)]),
  cart("an item discount plus a promotion", [line("agua", 2), line("soda", 1)]),
  cart("a combo", [combo, line("soda", 1)]),
  cart("a coupon with a minimum spend, met", [line("taco", 2)], { coupon: coupon("min100", "fixed", 20, 100) }),
  cart("a coupon with a minimum spend, not met", [line("taco", 1)], { coupon: coupon("min100", "fixed", 20, 100) }),
  cart("a bill with a service charge and a tip", [line("taco", 2), line("soda", 2)], { servicePct: 10, tipPct: 15 }),
  cart("service, tip and a percent coupon", [line("taco", 2), line("burger", 1)],
    { servicePct: 10, tipPct: 10, coupon: coupon("ten", "percent", 10) }),
  // Dishes MX$95 miss a MX$100 minimum; dishes plus 10% service (MX$104.50) do not.
  cart("service pushes the bill past a coupon minimum", [line("tostada", 1)],
    { servicePct: 10, coupon: coupon("min100", "fixed", 20, 100) }),
];

/** The menu_items read verifiedLines and currentOfflinePrice make, answered from MENU. */
export function fakeDb(): ReturnType<typeof createAdminClient> {
  const from = () => {
    let ids: string[] = [];
    const query = {
      select: () => query,
      eq: () => query,
      in: (_column: string, wanted: string[]) => { ids = wanted; return query; },
      then: (resolve: (r: { data: VerifiableItem[]; error: null }) => unknown) =>
        resolve({ data: MENU.filter(m => ids.includes(m.id)), error: null }),
    };
    return query;
  };
  return { from } as unknown as ReturnType<typeof createAdminClient>;
}
