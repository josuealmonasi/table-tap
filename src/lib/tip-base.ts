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
  return Math.max(0, round2(food - discount));
}

/** Legacy fee principal includes service; its frozen value must never grow with later tips. */
export function frozenTipPrincipal(principal: number | null, orders: TipOrder[]): number {
  return principal == null ? ordersTipBase(orders) : Math.max(0, round2(Number(principal)
    - orders.reduce((sum, o) => sum + Number(o.service_fee ?? 0), 0)));
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
