import { describe, expect, it, vi } from "vitest";
import { CARTS, MENU, PROMOTIONS, RESTAURANT, fakeDb, type ParityCart } from "./price-parity-fixtures";
import { read } from "./helpers";

vi.mock("@/lib/promotions-on-sale", () => ({ promotionsOnSale: async () => PROMOTIONS }));

import { applyCoupon, priceCart, type PricedCart } from "@/lib/pricing";
import { toCartPromos } from "@/lib/promotions";
import { verifiedLines } from "@/lib/checkout/verified-lines";
import { checkoutOrderRow } from "@/lib/checkout/order-row";
import { checkoutLineItems } from "@/lib/checkout/line-items";
import { couponProblem, toAppliedCoupon } from "@/lib/coupon-service";
import { orderItemsWithRevenue } from "@/lib/order-line-revenue";
import { currentOfflinePrice, sameOfflinePrice } from "@/lib/offline-pricing";
import { tableBill } from "@/lib/table-bill";
import { billAmounts } from "@/lib/bill-amounts";
import { sharesFor } from "@/lib/split";
import { billTotal as staffCouponBase, discountableOrders } from "@/lib/staff-discount";
import { round2 } from "@/lib/money";
import type { Order, OrderLineItem } from "@/lib/types";

/**
 * One cart, every pricing entry point, the same answer wherever the paths are
 * meant to agree. Each path is called through the library functions its route
 * calls, with the arguments the route passes:
 *
 *   diner checkout  verifiedLines → priceCart(coupon, tip) → checkoutOrderRow, checkoutLineItems
 *   till sale       priceCart(coupon: null, tip)                 (pos/order)
 *   waiter round    priceCart(no coupon, no tip)                 (table-order)
 *   offline replay  currentOfflinePrice → sameOfflinePrice       (pos-offline)
 *   diner bill      tableBill → billAmounts(coupon, tip%)        (bill sheet; bill/pay uses the same base)
 *   split           sharesFor over the bill
 *   staff coupon    discountableOrders → billTotal → applyCoupon (bill/discount, bill/discount/approve)
 */

const promos = toCartPromos(PROMOTIONS);
const restaurant = (c: ParityCart) => ({ service_pct: c.servicePct, service_enabled: c.servicePct > 0 });
const price = (c: ParityCart, items: OrderLineItem[], over: { tip?: boolean; coupon?: boolean } = {}): PricedCart =>
  priceCart({
    items, servicePct: c.servicePct, serviceEnabled: c.servicePct > 0, promos,
    tipPct: over.tip === false ? 0 : c.tipPct,
    coupon: over.coupon === false || !c.coupon ? null : toAppliedCoupon(c.coupon),
  });
const cents = (n: number) => Math.round(n * 100);
/** Dishes after item and quantity discounts, before any coupon: what a coupon is judged on. */
const couponBase = (p: PricedCart) => round2(p.grossSubtotal - p.itemDiscount - p.promoDiscount);

/** The order a pay-later round leaves on the table: no tip yet, no coupon. */
function storedOrder(c: ParityCart, verified: OrderLineItem[], waiter: PricedCart): Order {
  const row = checkoutOrderRow({
    restaurantId: RESTAURANT, table: { id: "t1", label: "1" }, sessionId: "s1", diner: "d1", deferred: true,
    pricing: waiter, taxPct: 16, couponCode: null, currency: "MXN", verified, note: undefined, customerName: undefined,
  });
  return { ...row, id: `o-${c.name}`, account_id: null, written_off: false, pay_method: null,
    stripe_payment_intent: null, stripe_refund_id: null, created_at: "2026-11-26T12:00:00Z" } as unknown as Order;
}

/** Marks a known disagreement: passes while it exists, fails once it is fixed so the marker is removed. */
function expectedGap(agree: boolean, what: string): void {
  expect(agree, `expected-gap now agrees: ${what} — remove the marker`).toBe(false);
}

describe.each(CARTS)("price parity: $name", c => {
  it("agrees on every path that is meant to agree", async () => {
    const result = await verifiedLines(fakeDb(), RESTAURANT, { items: c.items, promotions: PROMOTIONS, onOpenMenu: () => true });
    if (!result.ok) throw new Error(`fixture cart refused: ${JSON.stringify(result.rejection)}`);
    const verified = result.lines;
    // Prices came from the rows, not the forged MX$1 the cart sent.
    expect(verified.every(l => l.price > 1)).toBe(true);

    // Diner checkout: the authoritative price.
    const diner = price(c, verified);
    const noCoupon = price(c, verified, { coupon: false });
    // The coupon's minimum is claimed on the pre-coupon subtotal (claimCheckoutCoupon(base.subtotal)),
    // and priced on the same figure inside priceCart.
    expect(noCoupon.subtotal).toBe(couponBase(diner));
    if (c.coupon) expect(couponProblem(c.coupon, noCoupon.subtotal) === null).toBe(diner.couponDiscount > 0);

    const row = checkoutOrderRow({
      restaurantId: RESTAURANT, table: null, sessionId: null, diner: null, deferred: false, pricing: diner,
      taxPct: 16, couponCode: c.coupon?.code ?? null, currency: "MXN", verified, note: undefined, customerName: undefined,
    });
    expect([row.subtotal, row.discount, row.total, row.service_fee, row.tip])
      .toEqual([diner.subtotal, diner.discount, diner.total, diner.serviceFee, diner.tip]);
    // Line revenue is frozen before the coupon: it adds up to the coupon base, not the subtotal.
    expect(cents(row.items.reduce((s, l) => s + (l.promotionRevenue ?? 0), 0))).toBe(cents(couponBase(diner)));

    // Stripe is told the same total: dish lines + service + tip − (coupon + quantity deals).
    const stripe = checkoutLineItems({ verified, currency: "mxn", serviceFee: diner.serviceFee,
      servicePct: c.servicePct, tip: diner.tip, tipPct: c.tipPct });
    const charged = stripe.reduce((s, l) => s + (l.price_data?.unit_amount ?? 0) * (l.quantity ?? 1), 0);
    expect(charged - cents(diner.couponDiscount + diner.promoDiscount)).toBe(cents(diner.total));

    // Till: same engine, never a coupon ("a code is the diner's to spend, not the till's").
    const till = price(c, verified, { coupon: false });
    expect(till.couponDiscount).toBe(0);
    expect([till.grossSubtotal, till.itemDiscount, till.promoDiscount, till.promoSavings])
      .toEqual([diner.grossSubtotal, diner.itemDiscount, diner.promoDiscount, diner.promoSavings]);
    if (!c.coupon) expect(till.total).toBe(diner.total);

    // Waiter round: no coupon and no tip yet; the tip is decided when somebody pays.
    const waiter = price(c, verified, { coupon: false, tip: false });
    expect([waiter.subtotal, waiter.serviceFee, waiter.tip]).toEqual([till.subtotal, till.serviceFee, 0]);

    // Offline replay: today's menu reprices the till's receipt to exactly what the till charged.
    const current = await currentOfflinePrice(fakeDb(), RESTAURANT, { items: verified, tipPct: c.tipPct }, restaurant(c));
    expect(current?.price.total).toBe(till.total);
    const charge = { at: new Date().toISOString(), subtotal: till.subtotal, serviceFee: till.serviceFee,
      tip: till.tip, discount: till.discount, total: till.total };
    const receipt = orderItemsWithRevenue(verified, till);
    expect(sameOfflinePrice(charge, receipt, current)).toBe(true);
    expect(sameOfflinePrice({ ...charge, total: round2(charge.total + 0.01) }, receipt, current)).toBe(false);

    // Diner bill over the stored pay-later order, with the cart's coupon and tip applied at payment.
    const orders = [storedOrder(c, verified, waiter)];
    const coupon = c.coupon ? toAppliedCoupon(c.coupon) : null;
    const bill = billAmounts(tableBill(orders, []), "all", coupon, c.tipPct, null);
    expect([bill.dishes, bill.service, bill.priorTip]).toEqual([waiter.subtotal, waiter.serviceFee, 0]);
    // The same coupon on the same dishes takes the same amount off, and the tip follows the same base.
    expect(bill.couponOff).toBe(diner.couponDiscount);
    expect(bill.tip).toBe(diner.tip);
    // Meant to differ: the service on a stored order was charged when it was placed and a coupon
    // at payment does not re-price it; at checkout the service follows the discounted subtotal.
    expect(bill.total).toBe(round2(diner.total + (waiter.serviceFee - diner.serviceFee)));

    // Split: equal shares add back to exactly what is owed and to the tip base.
    for (const amount of [bill.base, bill.tipBase]) {
      expect(cents(sharesFor(amount, 3).reduce((s, n) => s + n, 0))).toBe(cents(amount));
    }

    // Staff coupon: should judge the same dishes the diner's bill judges.
    if (c.coupon) {
      const staffBase = staffCouponBase(discountableOrders(orders));
      const same = staffBase === bill.dishes
        && applyCoupon(toAppliedCoupon(c.coupon), staffBase) === bill.couponOff
        && (couponProblem(c.coupon, staffBase) === null) === (couponProblem(c.coupon, bill.dishes) === null);
      // expected-gap (claude/coupon-base-addon): the staff base is total − tip, service included.
      if (c.servicePct > 0) expectedGap(same, "staff coupon base includes the service charge");
      else expect(same, "staff coupon and diner bill disagree on a bill without service").toBe(true);
    }
  });
});

describe("price parity: the fixtures exercise what they claim", () => {
  it("covers extras, both promotion kinds, an item discount, a combo, coupons, service and tip", async () => {
    const priced = await Promise.all(CARTS.map(async c => {
      const r = await verifiedLines(fakeDb(), RESTAURANT, { items: c.items, promotions: PROMOTIONS, onOpenMenu: () => true });
      if (!r.ok) throw new Error(c.name);
      return { c, lines: r.lines, p: price(c, r.lines) };
    }));
    expect(priced.some(x => x.lines.some(l => l.extras?.length))).toBe(true);
    expect(priced.some(x => x.p.promoSavings.soda?.promoName === "2x1-soda")).toBe(true);
    // The tie goes to the earlier deal on every path, because every path runs bestPromoFor.
    expect(priced.find(x => x.c.name === "a 3x2 tie")!.p.promoSavings.taco?.promoName).toBe("3x2-taco");
    expect(priced.some(x => x.p.itemDiscount > 0 && x.p.promoDiscount > 0)).toBe(true);
    expect(priced.some(x => x.lines.some(l => l.comboId))).toBe(true);
    expect(priced.some(x => x.p.couponDiscount > 0)).toBe(true);
    expect(priced.some(x => x.c.coupon && x.p.couponDiscount === 0)).toBe(true);
    expect(priced.some(x => x.p.serviceFee > 0 && x.p.tip > 0)).toBe(true);
    expect(MENU.some(m => m.is_addon)).toBe(true);
  });

  it("bill/pay judges a coupon on the same dishes billAmounts does: the owed principal minus service", () => {
    const route = read("src/app/api/bill/pay/route.ts");
    expect(route).toMatch(/const dishes = Math\.max\(0, round2\(principal - orders\.reduce\(\(sum, o\) => sum \+ Number\(o\.service_fee/);
    expect(route).toMatch(/applyCoupon\(toAppliedCoupon\(coupon\), dishes\)/);
  });

  it("the till and the waiter round call priceCart the way this spec calls it", () => {
    const till = read("src/app/api/pos/order/route.ts");
    expect(till).toMatch(/priceCart\(\{[\s\S]*?coupon: null,[\s\S]*?promos: toCartPromos\(promotions\)/);
    const waiter = read("src/app/api/table-order/route.ts");
    const call = waiter.slice(waiter.indexOf("priceCart({"), waiter.indexOf("});", waiter.indexOf("priceCart({")));
    expect(call).not.toMatch(/tip|coupon/);
    expect(read("src/app/api/bill/discount/route.ts")).toMatch(/const food = billTotal\(orders\)/);
    expect(read("src/app/api/bill/discount/approve/route.ts")).toMatch(/const food = billTotal\(orders\)/);
  });
});
