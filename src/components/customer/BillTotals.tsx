"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
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
  const t = useT();
  if (a.collected) return <div className="tt-card" style={{ padding: 16 }}>
    <p>{t("returns.alreadyCollected", { amount: formatMoney(a.collected, restaurant.currency) })}</p>
    <div className="tt-row"><span>{t("returns.remaining")}</span><strong>{formatMoney(a.food, restaurant.currency)}</strong></div>
    {a.tip > 0 && <div className="tt-row"><span>{t("totals.tip")}</span><span>{formatMoney(a.tip, restaurant.currency)}</span></div>}
    <div className="tt-row"><strong>{t("totals.total")}</strong><strong>{formatMoney(a.total, restaurant.currency)}</strong></div>
  </div>;
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
