import { MANAGES } from "@/lib/membership";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import type { Actor } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { capName, capNote } from "@/lib/notes";
import { stockDemand, toDemandPayload } from "@/lib/stock";
import { orderCode } from "@/lib/types";
import { existingTicket, terminalRef, type PosSaleBody } from "@/lib/pos-sale";
import { offlineCharge, offlineDrift, offlineLines } from "@/lib/offline-sale";
import { readOfflineContext, contextCoveredSale } from "@/lib/offline-authority";
import { currentOfflinePrice, sameOfflinePrice } from "@/lib/offline-pricing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface OfflineApproval { reason: string; collector?: string; at?: string; currency?: string }

/**
 * A sale the till rang without a connection, sent now that it has one.
 *
 * It already happened: the customer paid and left with the food. A dish sold
 * out since or a menu closed since cannot undo it. Changed prices require a
 * manager's approval before the receipt joins the ledger. It is recorded at
 * the time it happened, for what was collected, finished (the kitchen worked
 * from the ticket at the time), and its stock is taken down to nought at most.
 * Today's menu prices it to show a manager the difference.
 *
 * Its reference is its id, so the code on the ticket the till printed offline
 * is the code the sale has, and a sale sent twice is rung once.
 */
export async function ringOffline(actor: Actor, body: PosSaleBody & { offline?: unknown }, approval?: OfflineApproval): Promise<NextResponse> {
  if (approval && !MANAGES(actor.role)) return await apiError("apiErr.forbidden", 403);
  const originalAt = (body.offline as { at?: unknown } | null)?.at;
  const charge = offlineCharge(approval?.at ? { ...(body.offline as object), at: approval.at } : body.offline, Date.now(), Boolean(approval));
  if (!charge) return await apiError("apiErr.offlineSale", 400, undefined, { held: true });
  if (body.method !== "cash" && body.method !== "card") return await apiError("apiErr.offlineMethod", 400);
  const posRef = typeof body.posRef === "string" && UUID.test(body.posRef) ? body.posRef : null;
  if (!posRef || !Array.isArray(body.items) || !body.items.length) return await apiError("apiErr.invalidRequest", 400);
  const db = createAdminClient();
  const already = await existingTicket(db, posRef, actor.restaurantId, body);
  if (already) return already;

  const context = readOfflineContext(body.collectorContext, actor.restaurantId);
  const collector = context?.collector ?? approval?.collector;
  if (!collector || (!approval && (!context || context.collector !== actor.email || !contextCoveredSale(context, charge.at)))) {
    return await apiError("apiErr.offlineCollector", 409, undefined, { held: true, reviewReason: "apiErr.offlineCollector" });
  }
  if (body.collectorContext && !context && !approval) return await apiError("apiErr.offlineCollector", 409, undefined, { held: true, reviewReason: "apiErr.offlineCollector" });
  if (context && approval?.collector && approval.collector !== context.collector) return await apiError("apiErr.offlineCollector", 409, undefined, { held: true, reviewReason: "apiErr.offlineCollector" });
  const currency = context?.currency ?? approval?.currency ?? body.currency;
  if (!approval && context && typeof body.currency === "string" && body.currency !== context.currency) {
    return await apiError("apiErr.offlineCollector", 409, undefined, { held: true, reviewReason: "apiErr.offlineCollector" });
  }
  if (currency !== "MXN" && currency !== "USD") return await apiError("apiErr.offlineCurrencyRequired", 409, undefined, { held: true, reviewReason: "apiErr.offlineCurrencyRequired" });
  const { data: restaurant } = await db.from("restaurants")
    .select("currency, tax_pct, service_pct, service_enabled").eq("id", actor.restaurantId).single();
  if (!restaurant) return await apiError("apiErr.forbidden", 403);
  // Pesos collected yesterday are not dollars because the restaurant switched
  // currency since: the sale would be recorded as US$100 for MX$100 in the
  // drawer. Manager approval preserves the collected currency, and reports
  // keep it apart. A legacy till that sent none needs manager attestation.
  if (!approval && currency !== restaurant.currency) return await apiError("apiErr.offlineCurrency", 409,
    { collected: currency, current: restaurant.currency }, { held: true, reviewReason: "recovery.currencyChanged" });
  // What the till sold, as it sold it: the lines, their prices and a combo's
  // parts. Recorded as they are on approval, because the sale happened — today's
  // menu repriced every line and, once a promotion had ended, dropped a combo's
  // parts, so stock came off the deal instead of the burger and the fries.
  const savedLines = offlineLines(body.items);
  if (!savedLines.length || savedLines.length !== body.items.length) return await apiError("apiErr.invalidRequest", 400);
  const current = await currentOfflinePrice(db, actor.restaurantId, body, restaurant).catch(() => undefined);
  if (current === undefined && !approval) return await apiError("apiErr.verifyOrders", 503, undefined, { held: true });
  if (!approval && !sameOfflinePrice(charge, savedLines, current ?? null)) {
    return await apiError("apiErr.offlineApproval", 409, undefined, { held: true, reviewReason: "apiErr.offlineApproval" });
  }
  const lines = approval ? savedLines : current!.lines;
  const { data: ticket, error } = await db.rpc("record_offline_sale", {
    p_restaurant: actor.restaurantId, p_ref: posRef, p_method: body.method, p_actor: collector,
    p_at: charge.at, p_terminal: body.method === "card" ? terminalRef(body.terminalRef) : null,
    p_demand: toDemandPayload(stockDemand(lines)),
    p_manager: approval ? actor.email : null, p_reason: approval?.reason ?? null,
    p_original_at: typeof originalAt === "string" ? originalAt.slice(0, 80) : null,
    p_authority: context ? "signed" : "manager_attested",
    p_order: { subtotal: charge.subtotal, service_fee: charge.serviceFee, tip: charge.tip,
      discount: charge.discount, total: charge.total, tax_pct: Number(restaurant.tax_pct) || 0,
      currency, items: lines, note: capNote(body.note) ?? null, customer_name: capName(body.customerName) ?? null,
      offline_drift: offlineDrift(charge.total, currency === restaurant.currency ? current?.price.total ?? null : null) },
  });
  // One transaction rings it — the order, the money and the stock — so two
  // sends racing meet on its lock and the second gets the first one's ticket.
  // An error may be a lost response after commit: deleting would orphan its
  // money, so the device simply sends again.
  if (error || !ticket) return await apiError("apiErr.orderCreate", 503, undefined, { held: true });
  if (ticket.outcome !== "settled") return await apiError("apiErr.posUnsettled", 409, undefined, { held: true });
  return NextResponse.json({ ...ticket, currency, method: body.method, code: orderCode(ticket.orderId), offline: true });
}
