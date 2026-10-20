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
import { existingTicket, otherRestaurant, terminalRef, type PosSaleBody } from "@/lib/pos-sale";
import { ringOffline } from "@/lib/pos-offline";
import { orderableNow } from "@/lib/checkout/orderable-now";
import { verifiedLines } from "@/lib/checkout/verified-lines";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/pos/order — a cashier rings a sale at the counter.
 *
 * The money is already in the drawer by the time this is called: the customer
 * paid cash, or a card on the restaurant's own terminal. Nothing here talks to
 * Stripe, which is why the order arrives paid and on the pass in one step
 * rather than waiting for anyone to confirm it.
 *
 * The order of work is what keeps it safe:
 *
 *   1. Price it from the DATABASE. The till sends what was ordered, never what
 *      it costs — same `verifyCart` and `priceCart` the diner's own cart runs,
 *      so a dish cannot be one price at the counter and another on a phone.
 *   2. Ring it in ONE transaction (`ring_pos_sale`, `ring_pos_account`): the
 *      stock, the order, the payment and the voucher commit together or not at
 *      all. If a portion went while the cashier was ringing it up, it refuses
 *      and names what is short before any payment is recorded — the
 *      alternative is selling food the kitchen cannot make.
 *   3. Then the log and the receipt, which a sale that happened survives.
 *
 * `pos_ref` makes the whole thing idempotent. A request that times out and is
 * sent again finds the ticket the first one rang, under the same lock, rather
 * than charging twice and putting a second ticket on the pass.
 */
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
  const elsewhere = await otherRestaurant(body, actor.restaurantId);
  if (elsewhere) return elsewhere;
  // Rung while the connection was gone and sent now: it already happened, so
  // it is recorded as it was taken rather than checked against the menu as a
  // new sale would be. Same role, freeze and plan checks as above.
  if (body.offline !== undefined) return await ringOffline(actor, body);
  const { posRef, items, method } = body;

  // The till's own random UUID, never a guessable string: the reference is
  // what a retry is matched on, and it becomes the order's id.
  if (typeof posRef !== "string" || !UUID.test(posRef) || !Array.isArray(items) || items.length === 0) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  if (method !== "cash" && method !== "card" && method !== "account") {
    return await apiError("apiErr.invalidRequest", 400);
  }
  // "Ponlo en mi cuenta": the food goes out now and the account owes it. The
  // cashier ringing it is the approval; the account's ceiling is checked
  // under its lock, in the same transaction that creates the sale.
  const onAccount = method === "account";
  if (onAccount) {
    if (typeof body.accountId !== "string") return await apiError("apiErr.invalidRequest", 400);
    const noAccounts = await planBlocks(actor.restaurantId, "openAccounts");
    if (noAccounts) return noAccounts;
  }

  const db = createAdminClient();

  // The same sale, sent twice. Answer with the ticket that already exists
  // rather than ringing it again — and only this restaurant's ticket.
  const already = await existingTicket(db, posRef, actor.restaurantId);
  if (already) return already;

  // Read with the secret key, not the staff session. `restaurants` grants a
  // browser only the columns a diner's menu needs, so a cashier's own client
  // cannot see `service_pct` — and a till that cannot read the service charge
  // cannot price a sale. Every query below is scoped to the actor's own
  // restaurant, which is what makes that safe.
  const { data: restaurant } = await db
    .from("restaurants")
    .select("id, name, currency, tax_pct, service_pct, service_enabled, timezone, low_stock_threshold, low_stock_alerts_enabled")
    .eq("id", actor.restaurantId)
    .single();
  if (!restaurant) return await apiError("apiErr.forbidden", 403);

  // Only what the restaurant is actually serving right now: a cashier should
  // not be able to ring a dish from a menu that closed at lunch. The same
  // decision the diner's own menu makes, from the same function.
  const { closedNow, onOpenMenu } = await orderableNow(db, actor.restaurantId);
  if (closedNow) return await apiError("apiErr.closedNow", 409);

  // Priced from the database by the same function checkout uses, so a dish
  // cannot be one price at the counter and another on a phone.
  const promotions = await promotionsOnSale(db, actor.restaurantId);
  const result = await verifiedLines(db, actor.restaurantId, { items, promotions, onOpenMenu });
  if (!result.ok) {
    if (!result.rejection) return await apiError("apiErr.verifyItems", 400);
    const { key, vars } = rejectionMessage(result.rejection);
    return await apiError(key, 400, vars);
  }
  const verified = result.lines;

  // No coupon: a code is the diner's to spend, not the till's to apply. The
  // tip and the service charge come from the same `priceCart` the diner's own
  // cart runs — two ways to price the same sale is the bug this shares code to
  // avoid, and an exact tip is capped there rather than trusted from here.
  const pricing = priceCart({
    items: verified,
    servicePct: restaurant.service_pct,
    serviceEnabled: restaurant.service_enabled,
    // On an account there is no tip yet: it is left when the account is paid.
    tipPct: onAccount ? 0 : Number(body.tipPct) || 0,
    tipAmount: !onAccount && typeof body.tipAmount === "number" ? body.tipAmount : undefined,
    coupon: null,
    promos: toCartPromos(promotions),
  });

  // Only at the counter. The flag means "needs no preparation", and the
  // counter is the one place where that also means already delivered — a
  // bottled water ordered from table 6 still has to be carried to table 6.
  //
  // And on Caja, always: it is the register on its own, with no kitchen board
  // for a sale to wait on, so every sale is served where it is paid.
  //
  // A sale of nothing but shelf items was handed over across the counter as
  // it was rung up, so it is finished, not waiting: no kitchen ticket, nothing
  // on the pass, no name to call out. One prepared line makes it an ordinary
  // order again.
  const plan = await getPlan(actor.restaurantId);
  const noBoard = plan ? !can(plan.limits, "kitchenBoard") : false;
  const handedOverAtOnce =
    verified.length > 0 && (noBoard || verified.every(line => line.skipsKitchen));

  const finalStatus = handedOverAtOnce ? "completed" : "received";

  // A changed menu must not settle more than the drawer received.
  const collected = body.collected === undefined ? null : offlineCharge(body.collected);
  if (body.collected !== undefined && (!collected || Math.abs(collected.total - pricing.total) > 0.005)) {
    // The drawer holds what the till charged, not today's price: refused here,
    // and kept on the device to be recorded as collected (`held`).
    return await apiError("apiErr.posMismatch", 409, undefined, { held: true });
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
  // Nothing of this reaches Stripe, so there is no application fee to take:
  // the subscription is what pays for the till (`platform_fee` is 0 in SQL).
  const { data: ticket, error } = onAccount
    ? await db.rpc("ring_pos_account_v2", { ...common, p_account: body.accountId })
    : await db.rpc("ring_pos_sale_v2", {
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
    // A reference that belongs to another order, here or anywhere: refused,
    // and nothing about that order is said.
    if (ticket.outcome === "conflict") return await apiError("apiErr.invalidRequest", 409);
    // A ticket that exists but is not settled yet: not a refusal of the sale —
    // the device keeps it and sends it again (`held`).
    return await apiError("apiErr.posUnsettled", 409, undefined, { held: true });
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

  // Logged as money taken, not as an order created, because that is what it
  // is — and because the drawer and the ledger are reconciled against each
  // other. `pnpm money` compares `bill/paid` rows with the payments they
  // should match; filing a counter sale anywhere else made the two records of
  // the same cash disagree by exactly the counter's takings.
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

  // "Do you want your receipt sent, or printed?" — whichever they answer,
  // `saleReceipt` handles it, and keeps no address.
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
    // What the device waits for before it lets go of its held copy.
    settled: true,
    receipt,
    receiptHtml,
    // So the screen can stop telling a cashier to call somebody who is already
    // walking away with their drink.
    handedOver: handedOverAtOnce,
  });
}
