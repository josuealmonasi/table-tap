import { applyCoupon, type AppliedCoupon } from "@/lib/pricing";
import { round2 } from "@/lib/money";
import { servicePercent, type TableBill } from "@/lib/table-bill";

export interface BillAmounts {
  /** What the chosen orders were priced at, service and any earlier tip included. */
  food: number;
  /** Promotions already taken off when the orders were placed or by the floor. */
  applied: number;
  couponOff: number;
  discount: number;
  /** What a new tip is worked out on: the food after this coupon. */
  base: number;
  tip: number;
  total: number;
  service: number;
  priorTip: number;
  dishes: number;
  servicePct: number;
}

/**
 * What the part of the bill being paid comes to, line by line.
 *
 * `food` is what the orders were priced at, service and any tip included —
 * passed as the subtotal, a MX$4.00 salad read "Subtotal MX$4.40" with no line
 * saying where the forty cents came from. Each part gets its own line, and the
 * lines add up to exactly what the button charges. Promotions already taken
 * off are shown too: `food` is net of them, so the lines above add up to more
 * than the total unless they are, and a bill that doesn't add up is a bill
 * nobody trusts.
 */
export function billAmounts(
  bill: TableBill,
  scope: "all" | "mine",
  coupon: AppliedCoupon | null,
  tipPct: number,
  tipCustom: number | null,
): BillAmounts {
  const food = scope === "mine" ? bill.mine.total : bill.total;
  const applied = scope === "mine" ? bill.mine.discount : bill.discount;
  const couponOff = coupon ? applyCoupon(coupon, food) : 0;
  const discount = round2(applied + couponOff);
  const base = round2(food - couponOff);
  const tip =
    tipCustom !== null ? Math.min(tipCustom, base) : round2(base * (tipPct / 100));
  const total = round2(base + tip);
  const service = scope === "mine" ? bill.mine.service : bill.service;
  const priorTip = scope === "mine" ? bill.mine.tip : bill.tip;
  const dishes = round2(food - service - priorTip);
  return {
    food,
    applied,
    couponOff,
    discount,
    base,
    tip,
    total,
    service,
    priorTip,
    dishes,
    servicePct: servicePercent(service, dishes),
  };
}
