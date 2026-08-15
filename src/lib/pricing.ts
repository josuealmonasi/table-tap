import type { OrderLineItem } from "@/lib/types";
import { nextPromoStep, promoCost, type QuantityPromo } from "@/lib/promo-math";

// The single source of truth for what a cart costs. Pure — no IO, no DB — so
// the customer's preview and the server's actual charge run the exact same
// maths. The client renders whatever this returns; /api/checkout re-runs it on
// DB-fetched prices and promos, and that result is what Stripe is told.

/** A quantity deal plus the products it applies to. */
export interface CartPromo extends QuantityPromo {
  itemIds: string[];
}

/**
 * What a coupon takes off a given amount of goods.
 *
 * Split out of priceCart because the same sum is needed where there is no cart
 * at all — settling a dine-in bill prices stored orders, not cart lines — and
 * two copies of this would be two answers to "how much is my discount".
 *
 * Never more than the goods are worth, so a total can't go negative.
 */
export function applyCoupon(coupon: AppliedCoupon, base: number): number {
  if (base < (coupon.minSubtotal ?? 0)) return 0;
  const raw =
    coupon.kind === "percent" ? round2(base * (coupon.value / 100)) : coupon.value;
  return Math.max(0, Math.min(round2(raw), base));
}

/**
 * The most of one dish a single line may order.
 *
 * A phone can send any number it likes. Nothing downstream refused one, so a
 * request for 100,000 desserts was accepted: MX$638,000 owed by a real table
 * and a ticket the kitchen would have to read. No party orders ninety-nine of
 * anything, and a table that truly wants more can add a second line.
 */
export const MAX_LINE_QTY = 99;

/** A coupon that has already been looked up and confirmed to exist. */
export interface AppliedCoupon {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  minSubtotal?: number;
}

export interface PriceInput {
  items: OrderLineItem[];
  /** Restaurant service charge — applied only when enabled. */
  servicePct: number;
  serviceEnabled: boolean;
  /** Preset tip percentage (ignored when tipAmount is given). */
  tipPct?: number;
  /** Exact "other" tip amount, capped at the discounted subtotal. */
  tipAmount?: number | null;
  promos?: CartPromo[];
  coupon?: AppliedCoupon | null;
}

export interface PricedLine {
  itemId: string;
  qty: number;
  /** Undiscounted cost of this line (base + extras) × qty. */
  gross: number;
  /** Unit price once the item's own discount is applied, including extras. */
  unit: number;
}

/** "Add 1 more and save $2" — surfaced in the cart and on the item screen. */
export interface PromoHint {
  itemId: string;
  promoName: string;
  addQty: number;
  save: number;
}

export interface ItemPromoSaving {
  /** What the deal takes off this product's lines, in total. */
  saved: number;
  /** The deal's name, so the cart can say WHICH offer applied. */
  promoName: string;
}

export interface PricedCart {
  grossSubtotal: number;
  itemDiscount: number;
  promoDiscount: number;
  couponDiscount: number;
  /** Everything taken off, i.e. the three discounts above. */
  discount: number;
  /** grossSubtotal − discount. Service fee and tip are based on this. */
  subtotal: number;
  serviceFee: number;
  tip: number;
  total: number;
  lines: PricedLine[];
  hints: PromoHint[];
  /**
   * Per-product deal savings, so the cart can strike the original price rather
   * than only moving the order total. Without this the customer saw "5×
   * Sparkling Water MX$12.50" with the 2x1 applied silently three lines down,
   * which reads as the deal not having worked.
   */
  promoSavings: Record<string, ItemPromoSaving>;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const extrasTotal = (line: OrderLineItem): number =>
  line.extras?.reduce((sum, e) => sum + e.price, 0) ?? 0;

/**
 * What one unit of an item costs after its own % discount. Shared with the menu
 * and item screens so the struck-through price the customer sees is exactly the
 * number this engine charges.
 */
export function itemSalePrice(price: number, discountPct?: number | null): number {
  const pct = Math.min(100, Math.max(0, discountPct ?? 0));
  return round2(price * (1 - pct / 100));
}

/** The base price of one unit after the item's own % discount. */
function discountedBase(line: OrderLineItem): number {
  // A combo's `price` is already the bundle price — never discount it again.
  if (line.comboId) return line.price;
  return itemSalePrice(line.price, line.discountPct);
}

export function priceCart(input: PriceInput): PricedCart {
  const { items, promos = [], coupon = null } = input;

  let grossSubtotal = 0;
  let itemDiscount = 0;
  const lines: PricedLine[] = [];

  // 1. Per-line: apply each item's own discount. Extras are always full price.
  for (const line of items) {
    const qty = Math.min(MAX_LINE_QTY, Math.max(0, Math.floor(line.qty)));
    const extras = extrasTotal(line);
    const grossUnit = line.price + extras;
    const unit = discountedBase(line) + extras;

    grossSubtotal += grossUnit * qty;
    itemDiscount += (grossUnit - unit) * qty;
    lines.push({ itemId: line.itemId, qty, gross: round2(grossUnit * qty), unit });
  }

  // 2. Quantity deals apply per product, across every line of that product, to
  //    the WHOLE unit price — the discounted base plus whatever extras that
  //    unit carries. A free unit of a 2x1 is free as ordered: a $5 dish with a
  //    $2 extra is a $7 unit, so two cost $7, not $7 plus both extras again.
  //    (Combos are the other way round by design — extras there are charged on
  //    top of the bundle price, because the bundle is the discount.)
  const qtyByItem = new Map<string, number>();
  const unitByItem = new Map<string, number>();
  for (const line of items) {
    if (line.comboId) continue; // a combo is priced as a unit, not per product
    const qty = Math.max(0, Math.floor(line.qty));
    qtyByItem.set(line.itemId, (qtyByItem.get(line.itemId) ?? 0) + qty);
    // If the same product appears twice at different prices — a different set
    // of extras, say — the lower one wins, so the deal never takes more off
    // than the cheapest unit was worth.
    const unit = discountedBase(line) + extrasTotal(line);
    const seen = unitByItem.get(line.itemId);
    unitByItem.set(line.itemId, seen === undefined ? unit : Math.min(seen, unit));
  }

  let promoDiscount = 0;
  const promoSavings: Record<string, ItemPromoSaving> = {};

  // A combo is already sold at its bundle price, so there's nothing left to
  // discount — but the cart should still show what the bundle saved, the same
  // way the menu card does. This records the saving for display only; it
  // deliberately does NOT touch promoDiscount, or the bundle would be
  // discounted twice.
  for (const line of items) {
    if (!line.comboId || !line.comboRegular) continue;
    const qty = Math.max(0, Math.floor(line.qty));
    const saved = round2((line.comboRegular - line.price) * qty);
    if (saved > 0) promoSavings[line.itemId] = { saved, promoName: line.name };
  }
  const hints: PromoHint[] = [];
  const claimed = new Set<string>(); // one deal per product — the first wins

  for (const promo of promos) {
    for (const itemId of promo.itemIds) {
      const qty = qtyByItem.get(itemId);
      const unit = unitByItem.get(itemId);
      if (!qty || unit === undefined || claimed.has(itemId)) continue;
      claimed.add(itemId);

      const saved = round2(qty * unit - promoCost(promo, qty, unit));
      promoDiscount += saved;
      if (saved > 0) promoSavings[itemId] = { saved, promoName: promo.name };

      const step = nextPromoStep(promo, qty, unit);
      if (step) {
        hints.push({ itemId, promoName: promo.name, ...step });
      }
    }
  }

  grossSubtotal = round2(grossSubtotal);
  itemDiscount = round2(itemDiscount);
  promoDiscount = round2(promoDiscount);

  // 3. The coupon stacks on top, against what's left after the promos, and can
  //    never take off more than the goods are worth.
  const couponBase = round2(grossSubtotal - itemDiscount - promoDiscount);
  const couponDiscount = coupon ? applyCoupon(coupon, couponBase) : 0;

  const discount = round2(itemDiscount + promoDiscount + couponDiscount);
  const subtotal = round2(grossSubtotal - discount);

  // 4. Service charge and tip both follow the discounted subtotal.
  const servicePct = input.serviceEnabled ? input.servicePct : 0;
  const serviceFee = round2(subtotal * (servicePct / 100));
  const tip =
    input.tipAmount != null && input.tipAmount > 0
      ? Math.min(round2(input.tipAmount), subtotal)
      : round2(subtotal * ((input.tipPct ?? 0) / 100));

  return {
    grossSubtotal,
    itemDiscount,
    promoDiscount,
    couponDiscount,
    discount,
    subtotal,
    serviceFee,
    tip,
    total: round2(subtotal + serviceFee + tip),
    lines,
    hints,
    promoSavings,
  };
}
