import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { rejectionMessage } from "@/lib/cart-rejection";
import { jsonBody } from "@/lib/json-body";
import { actingStaff } from "@/lib/api-guard";
import { TAKES_COUNTER_ORDERS } from "@/lib/membership";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";
import { getPlan } from "@/lib/plan-server";
import { can } from "@/lib/plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { capName, capNote } from "@/lib/notes";
import { priceCart } from "@/lib/pricing";
import { promotionsOnSale } from "@/lib/promotions-on-sale";
import { toCartPromos } from "@/lib/promotions";
import { raiseStockNotifications } from "@/lib/stock-service";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { orderCode } from "@/lib/types";
import { chargeRefusal, type ChargeResult } from "@/lib/account-charge";
import { offlineCharge } from "@/lib/offline-sale";
import { stockDemand, toDemandPayload, parseReserveResult } from "@/lib/stock";
import { saleReceipt } from "@/lib/pos-receipt";
import { existingTicket, terminalRef, type PosSaleBody } from "@/lib/pos-sale";
import { ringOffline } from "@/lib/pos-offline";
import { orderableNow } from "@/lib/checkout/orderable-now";
import { verifiedLines } from "@/lib/checkout/verified-lines";

export const runtime = "nodejs";

/** The till validates the cart; one database transaction rings the whole sale. */
export async function POST(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  if (!TAKES_COUNTER_ORDERS(actor.role)) return await apiError("apiErr.forbidden", 403);

  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;
  const blocked = await planBlocks(actor.restaurantId, "pos");
  if (blocked) return blocked;

  const body = await jsonBody<PosSaleBody & { offline?: unknown }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  if (body.offline !== undefined) return await ringOffline(actor, body);
  const { posRef, items, method } = body;

  if (typeof posRef !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(posRef) || !Array.isArray(items) || items.length === 0) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  if (method !== "cash" && method !== "card" && method !== "account") {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const onAccount = method === "account";
  if (onAccount) {
    if (typeof body.accountId !== "string") return await apiError("apiErr.invalidRequest", 400);
    const noAccounts = await planBlocks(actor.restaurantId, "openAccounts");
    if (noAccounts) return noAccounts;
  }

  const db = createAdminClient();

  const already = await existingTicket(db, posRef, actor.restaurantId);
  if (already) return already;

  const { data: restaurant } = await db
    .from("restaurants")
    .select("id, name, currency, tax_pct, service_pct, service_enabled, timezone, low_stock_threshold, low_stock_alerts_enabled")
    .eq("id", actor.restaurantId)
    .single();
  if (!restaurant) return await apiError("apiErr.forbidden", 403);

  const { closedNow, onOpenMenu } = await orderableNow(db, actor.restaurantId);
  if (closedNow) return await apiError("apiErr.closedNow", 409);

  const promotions = await promotionsOnSale(db, actor.restaurantId);
  const result = await verifiedLines(db, actor.restaurantId, { items, promotions, onOpenMenu });
  if (!result.ok) {
    if (!result.rejection) return await apiError("apiErr.verifyItems", 400);
    const { key, vars } = rejectionMessage(result.rejection);
    return await apiError(key, 400, vars);
  }
  const verified = result.lines;

  const pricing = priceCart({
    items: verified,
    servicePct: restaurant.service_pct,
    serviceEnabled: restaurant.service_enabled,
    tipPct: onAccount ? 0 : Number(body.tipPct) || 0,
    tipAmount: !onAccount && typeof body.tipAmount === "number" ? body.tipAmount : undefined,
    coupon: null,
    promos: toCartPromos(promotions),
  });

  const plan = await getPlan(actor.restaurantId);
  const noBoard = plan ? !can(plan.limits, "kitchenBoard") : false;
  const handedOverAtOnce =
    verified.length > 0 && (noBoard || verified.every(line => line.skipsKitchen));

  const finalStatus = handedOverAtOnce ? "completed" : "received";

  // A changed menu must not settle more than the drawer received.
  const collected = body.collected === undefined ? null : offlineCharge(body.collected);
  if (body.collected !== undefined && (!collected || Math.abs(collected.total - pricing.total) > 0.005)) {
    return await apiError("apiErr.posMismatch", 409);
  }
  const common = {
    p_restaurant: actor.restaurantId, p_ref: posRef, p_actor: actor.email, p_status: finalStatus,
    p_threshold: Number(restaurant.low_stock_threshold) || 0,
    p_inventory: Boolean(plan && can(plan.limits, "inventory")),
    p_demand: toDemandPayload(stockDemand(verified)),
    p_order: {
      subtotal: pricing.subtotal, service_fee: pricing.serviceFee, tip: pricing.tip,
      tax_pct: Number(restaurant.tax_pct) || 0, discount: pricing.discount, total: pricing.total,
      promo_detail: pricing.discount > 0 ? { item: pricing.itemDiscount, promos: pricing.promoDiscount, coupon: 0 } : null,
      currency: restaurant.currency, items: verified, note: capNote(body.note) ?? null,
      customer_name: capName(body.customerName) ?? null,
    },
  };
  const { data: ticket, error } = onAccount
    ? await db.rpc("ring_pos_account", { ...common, p_account: body.accountId })
    : await db.rpc("ring_pos_sale", {
        ...common, p_method: method, p_at: null,
        p_terminal: method === "card" ? terminalRef(body.terminalRef) : null,
      });
  // The transaction owns cleanup: a lost response may already have committed.
  if (error || !ticket) return await apiError("apiErr.orderCreate", 503);
  if (ticket.outcome === "stock") {
    return NextResponse.json({ short: parseReserveResult(ticket).short, code: "outOfStock" }, { status: 409 });
  }
  if (ticket.outcome !== "settled") {
    if (onAccount && ["limit", "closed", "stale", "paying", "partly_paid"].includes(ticket.outcome)) {
      return await chargeRefusal(ticket as Exclude<ChargeResult, { outcome: "charged" }>, restaurant.currency);
    }
    return await apiError("apiErr.posUnsettled", 409);
  }
  if (ticket.repeat) return NextResponse.json({ ...ticket, code: orderCode(ticket.orderId) });
  const order = { id: ticket.orderId as string };
  if (restaurant.low_stock_alerts_enabled) {
    await raiseStockNotifications(actor.restaurantId, parseReserveResult({ ok: true, low: ticket.low }).low);
  }
  if (onAccount) {
    await logEvent({ restaurantId: actor.restaurantId, actor: actor.email, entity: "account", action: "charged",
      detail: logDetail({ name: ticket.onAccount.name, code: orderCode(order.id), amount: pricing.total.toFixed(2), owed: Number(ticket.onAccount.owed).toFixed(2) }) });
    return NextResponse.json({ ...ticket, code: orderCode(order.id) });
  }

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "bill",
    action: "paid",
    detail: logDetail({
      code: orderCode(order.id as string),
      amount: pricing.total.toFixed(2),
      method,
    }),
  });

  const { receipt, receiptHtml } = await saleReceipt({
    db,
    order: order as { id: string },
    verified,
    pricing,
    restaurant,
    method,
    body,
  });

  return NextResponse.json({
    orderId: order.id,
    code: orderCode(order.id as string),
    total: pricing.total,
    settled: true,
    receipt,
    receiptHtml,
    handedOver: handedOverAtOnce,
  });
}
