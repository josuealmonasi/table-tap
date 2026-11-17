import { round2 } from "./money";
import { sharesFor } from "./split";

export interface TipOrder {
  total: number; service_fee?: number; tip?: number; collected?: number; collected_tip?: number;
}

/**
 * Dishes after discounts, excluding service, old tips and collected principal.
 * What was already collected paid food and service in proportion, so only the
 * food part of it leaves the base: subtracting it whole after the whole service
 * charge counted the collected service twice (MX$100 food + MX$10 service, half
 * paid, gave MX$45 where MX$50 of food is still owed).
 */
export function ordersTipBase(orders: TipOrder[], discount = 0): number {
  const food = orders.reduce((sum, o) => {
    const principal = Math.max(0, Number(o.total) - Number(o.tip ?? 0));
    if (principal <= 0) return sum;
    const dishes = Math.max(0, principal - Number(o.service_fee ?? 0));
    const paid = Math.min(principal, Math.max(0, Number(o.collected ?? 0) - Number(o.collected_tip ?? 0)));
    return sum + dishes * (principal - paid) / principal;
  }, 0);
  // A discount only ever lowers the base: a negative one would raise the tip.
  return Math.max(0, round2(food - Math.max(0, Number(discount) || 0)));
}

/**
 * A split's frozen principal is what its orders still owed when the table
 * agreed: food AND service, net of anything already collected. Only its food
 * share is tipped, in the orders' own food-to-service proportion. Subtracting
 * the whole service charge instead took off service that a collection had
 * already paid: MX$100 food + MX$10 service with MX$55 collected froze MX$55,
 * and "minus MX$10" tipped MX$45 where MX$50 of food was owed (Codex review).
 * Its frozen value never grows with later tips.
 */
export function frozenTipPrincipal(principal: number | null, orders: TipOrder[]): number {
  if (principal == null) return ordersTipBase(orders);
  const owed = orders.reduce((sum, o) => sum + Math.max(0, Number(o.total) - Number(o.tip ?? 0)), 0);
  const food = orders.reduce((sum, o) => sum + Math.max(0,
    Number(o.total) - Number(o.tip ?? 0) - Number(o.service_fee ?? 0)), 0);
  if (owed <= 0) return 0;
  return Math.max(0, round2(Number(principal) * food / owed));
}

/**
 * The tip principal of a split, whichever version froze it. A v1 split locked
 * before `food_principal` existed froze a gross `amount`, which can include
 * earlier tips. Today's orders cannot say which tips were already in that
 * amount and which another share added later. Reading today's remaining debt
 * also shrank the base with each payment (review M4). Keep that uncertainty
 * explicit: those old shares accept exact tips, never an inferred percentage.
 * Only a split never locked falls back to the orders.
 */
export function splitTipPrincipal(split: TipSplit, orders: TipOrder[]): number | null {
  if (splitTakesExactTipOnly(split)) return null;
  return frozenTipPrincipal(split.food_principal, orders);
}

export interface TipSplit { food_principal: number | null; amount?: number | null }

/**
 * The one rule for "this share takes an exact tip, never a percentage": a v1
 * split that froze a positive gross with no food principal. The pay route
 * refuses a percentage by it, and `splitTipPrincipal` sends the screen `null`
 * by it, so the screen offers the exact field exactly when the route needs
 * one. A zero or missing amount has nothing gross to be unsure about.
 */
export function splitTakesExactTipOnly(split: TipSplit): boolean {
  return split.food_principal == null && Number(split.amount ?? 0) > 0;
}

/** The screen's side of `splitTakesExactTipOnly`: the server sent no principal. */
export function screenTakesExactTipOnly(split: { tipPrincipal?: number | null }): boolean {
  return split.tipPrincipal === null;
}

/** Each frozen food cent belongs to one share; the first carries the remainder. */
export function splitTipBase(principal: number, shares: number, selected: number[], ownBase = 0): number {
  const parts = sharesFor(principal, shares);
  return round2(selected.reduce((sum, n) => sum + (parts[n] ?? 0), 0) + ownBase);
}

/** The only percentage-tip formula, shared by previews and pay routes. */
export function tipFromPercent(base: number, pct: number): number {
  const safe = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  return Number.isFinite(base) ? round2(Math.max(0, base) * (safe / 100)) : 0;
}
