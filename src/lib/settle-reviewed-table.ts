import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import type { Actor } from "@/lib/api-guard";
import { recordReviewed } from "@/lib/reviewed-collection";
import { closeBill } from "@/lib/part-payment";
import { formatMoney } from "@/lib/format";
import { isDinerCurrency } from "@/lib/diner-currency";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

/** Full collection stays available on every plan, with the same reviewed balance. */
export async function settleReviewedTable(actor: Actor, tableId: string, body: { expected?: number; currency?: string; ref?: string }, method: "cash" | "card") {
  if (!isDinerCurrency(body.currency) || !Number.isFinite(body.expected) || Number(body.expected) < 0 || !body.ref) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  // A prior receipt may have landed while closing failed. Retry only the
  // close; its coverage guard refuses a new round without taking more money.
  if (body.expected === 0) {
    const settled = await closeBill(actor, tableId, method, body.currency);
    return settled ? NextResponse.json({ ok: true, settled, amount: 0, tip: 0, currency: body.currency }) : await apiError("apiErr.billChanged", 409);
  }
  const result = await recordReviewed(actor, { tableId, expected: Number(body.expected), currency: body.currency }, Number(body.expected), 0, method, body.ref);
  if (result.changed) return await apiError("apiErr.collectionBalanceChanged", 409, { owed: formatMoney(result.owed, body.currency) }, { owed: result.owed, currency: body.currency });
  if (!result.wrote && !result.refused) return await apiError("apiErr.accountBillPaying", 409);
  const settled = await closeBill(actor, tableId, method, body.currency);
  if (result.wrote) await logEvent({ restaurantId: actor.restaurantId, actor: actor.email, entity: "bill", action: "paid",
    detail: logDetail({ amount: result.landed.toFixed(2), tip: result.tip.toFixed(2), currency: body.currency, method }) });
  return NextResponse.json({ ok: true, settled, duplicate: result.refused, amount: result.landed, tip: result.tip, currency: body.currency });
}
