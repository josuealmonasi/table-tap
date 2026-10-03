"use client";

import type { BillAmounts } from "@/lib/bill-amounts";
import type { Restaurant } from "@/lib/types";
import { round2 } from "@/lib/money";
import OrderTotals from "./OrderTotals";

interface BillTotalsProps {
  amounts: BillAmounts;
  restaurant: Restaurant;
  tipPct: number;
  tipCustom: number | null;
}

/** What the share being paid comes to, on the checkout's own totals card. */
export default function BillTotals({ amounts: a, restaurant, tipPct, tipCustom }: BillTotalsProps) {
  return (
    <OrderTotals
      subtotal={Math.max(0, round2(a.dishes - a.couponOff))}
      grossSubtotal={round2(a.dishes + a.applied)}
      discount={a.discount}
      serviceFee={a.service}
      tip={round2(a.priorTip + a.tip)}
      tipPct={tipCustom !== null || a.priorTip > 0 ? 0 : tipPct}
      total={a.total}
      servicePct={a.servicePct}
      taxPct={Number(restaurant.tax_pct) || 0}
      taxBreakdown={Boolean(restaurant.tax_show_breakdown)}
      currency={restaurant.currency}
    />
  );
}
