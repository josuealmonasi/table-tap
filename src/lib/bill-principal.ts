import { round2 } from "@/lib/money";

interface PrincipalOrder { id: string; total: number; tip?: number; collected?: number; collected_tip?: number }

/** Existing gratuities belong to staff, including the part already collected. */
export function remainingPrincipal(orders: PrincipalOrder[]): number {
  return round2(orders.reduce((sum, o) => sum + Math.max(0,
    Number(o.total) - Number(o.collected ?? 0) - Math.max(0, Number(o.tip ?? 0) - Number(o.collected_tip ?? 0))), 0));
}

/** Allocate every discount cent before Stripe hears the quote; no receipt gets the full bill's discount. */
export function billEntitlements(orders: PrincipalOrder[], discount: number): { entitlements: Record<string, number>; discounts: Record<string, number> } {
  const entitlements: Record<string, number> = {};
  const discounts: Record<string, number> = {};
  let left = Math.round(discount * 100);
  const principal = orders.map(o => Math.round(remainingPrincipal([o]) * 100));
  let remaining = principal.reduce((sum, n) => sum + n, 0);
  orders.forEach((o, i) => {
    const off = remaining > 0 ? Math.min(principal[i], Math.round(left * principal[i] / remaining)) : 0;
    discounts[o.id] = off / 100;
    entitlements[o.id] = round2(Number(o.total) - Number(o.collected ?? 0) - off / 100);
    left -= off;
    remaining -= principal[i];
  });
  if (left !== 0) throw new Error("Coupon exceeds the remaining food principal");
  return { entitlements, discounts };
}
