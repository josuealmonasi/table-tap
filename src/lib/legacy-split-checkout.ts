import type Stripe from "stripe";
import type { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { formatMoney } from "@/lib/format";
import { round2 } from "@/lib/money";

/** Check both resumed pages and a concurrent winner returned by the opener. */
export async function legacySplitCheckoutError(
  session: Stripe.Checkout.Session, payable: number, tip: number,
): Promise<NextResponse | null> {
  const evidence = session.metadata?.settle_tip;
  const savedTip = Number(evidence);
  if (!evidence?.trim() || !Number.isFinite(savedTip) || savedTip < 0) {
    return await apiError("apiErr.verifyOrders", 503);
  }
  if (savedTip !== tip) return await apiError("apiErr.splitOpenTip", 409,
    { tip: formatMoney(savedTip, session.currency?.toUpperCase() ?? "MXN") });
  if (session.amount_total !== Math.round(round2(payable + tip) * 100)) {
    return await apiError("apiErr.billChanged", 409);
  }
  return null;
}
