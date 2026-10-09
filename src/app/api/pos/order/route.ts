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
import { raiseStockNotifications, releaseStock, reserveStock } from "@/lib/stock-service";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { orderCode } from "@/lib/types";
import { ringOnAccount } from "@/lib/account-sale";
import { saleReceipt } from "@/lib/pos-receipt";
import { existingTicket, type PosSaleBody } from "@/lib/pos-sale";
import { orderableNow } from "@/lib/checkout/orderable-now";
import { verifiedLines } from "@/lib/checkout/verified-lines";

export const runtime = "nodejs";

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
 *   2. Take the stock. If a portion went while the cashier was ringing it up
 *      this refuses and names what is short, BEFORE any payment is recorded —
 *      the alternative is selling food the kitchen cannot make.
 *   3. Then write the order, the payment and the log.
 *
 * `pos_ref` makes the whole thing idempotent. A request that times out and is
 * sent again lands on a unique index rather than charging twice and putting a
 * second ticket on the pass.
 */
export async function POST(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  if (!TAKES_COUNTER_ORDERS(actor.role)) return await apiError("apiErr.forbidden", 403);

  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;
  const blocked = await planBlocks(actor.restaurantId, "pos");
  if (blocked) return blocked;

  const body = await jsonBody<PosSaleBody>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { posRef, items, method } = body;

  if (!posRef || !Array.isArray(items) || items.length === 0) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  if (method !== "cash" && method !== "card" && method !== "account") {
    return await apiError("apiErr.invalidRequest", 400);
  }
  // "Ponlo en mi cuenta": the food goes out now and the account owes it. The
  // cashier ringing it is the approval; the account's ceiling is checked
  // under its lock once the sale exists.
  const onAccount = method === "account";
  if (onAccount) {
    if (typeof body.accountId !== "string") return await apiError("apiErr.invalidRequest", 400);
    const noAccounts = await planBlocks(actor.restaurantId, "openAccounts");
    if (noAccounts) return noAccounts;
  }

  const db = createAdminClient();

  // The same sale, sent twice. Answer with the ticket that already exists
  // rather than ringing it again.
  const already = await existingTicket(db, posRef);
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
  const plan = await getPlan(actor.restaurantId);
  const noBoard = plan ? !can(plan.limits, "kitchenBoard") : false;
  const handedOverAtOnce =
    verified.length > 0 && (noBoard || verified.every(line => line.skipsKitchen));

  const finalStatus = handedOverAtOnce ? "completed" : "received";

  const reservation = await reserveStock(
    actor.restaurantId,
    verified,
    Number(restaurant.low_stock_threshold) || 0,
  );
  if (!reservation.ok) {
    // Nothing has been written and no payment recorded: the cashier can put a
    // portion back and ring it again, which is what a counter actually does.
    return NextResponse.json(
      { short: reservation.short, code: "outOfStock" },
      { status: 409 },
    );
  }

  const { data: order, error } = await db
    .from("orders")
    .insert({
      stock_managed: true,
      stock_reservation_id: reservation.reservationId,
      restaurant_id: actor.restaurantId,
      table_id: null,
      table_label: null,
      session_id: null,
      // Straight to the pass, because the money is in the drawer before this
      // request is made and there is nothing to wait for.
      //
      // Unless there is nothing to make. A sale of nothing but shelf items —
      // a bottled drink, a packaged snack — was handed over across the counter
      // as it was rung up, so it is finished, not waiting: no kitchen ticket,
      // nothing on the pass, and no name to call out. One prepared line is
      // enough to make it an ordinary order again.
      //
      // A paid sale goes in as `pending_payment` and `settle_sale` gives it
      // this status as it records the money, so the two land together. On an
      // account nothing has been paid: the account owes it.
      status: onAccount ? finalStatus : "pending_payment",
      paid: false,
      pay_method: null,
      pos_ref: posRef,
      subtotal: pricing.subtotal,
      service_fee: pricing.serviceFee,
      tip: pricing.tip,
      tax_pct: Number(restaurant.tax_pct) || 0,
      discount: pricing.discount,
      // Nothing of this reaches Stripe, so there is no application fee to take.
      // The subscription is what pays for the till.
      platform_fee: 0,
      promo_detail:
        pricing.discount > 0
          ? { item: pricing.itemDiscount, promos: pricing.promoDiscount, coupon: 0 }
          : null,
      total: pricing.total,
      currency: restaurant.currency,
      items: verified,
      note: capNote(body.note) ?? null,
      // How they get called when it is ready. Optional, and the only personal
      // thing a counter order keeps.
      customer_name: capName(body.customerName) ?? null,
    })
    .select("id")
    .single();

  if (error || !order) {
    // Each racing request reserved its own portions. The losing insert must
    // return its reservation, while the winner keeps the one on its order.
    if (error?.code === "23505") {
      const won = await existingTicket(db, posRef);
      if (won) {
        await releaseStock(actor.restaurantId, reservation.reservationId);
        return won;
      }
    }
    await releaseStock(actor.restaurantId, reservation.reservationId);
    return await apiError("apiErr.orderCreate", 500);
  }

  if (onAccount) {
    return await ringOnAccount({
      restaurantId: actor.restaurantId,
      accountId: body.accountId as string,
      orderId: order.id as string,
      total: pricing.total,
      actor: actor.email,
      release: () => releaseStock(actor.restaurantId, reservation.reservationId),
    });
  }

  // Paid, its real status, and the money in the ledger: one write. They were
  // two, and a failed second one was a sale with no money in the corte. If it
  // fails the sale did not happen — the order goes and its stock comes back.
  const { error: settleError } = await db.rpc("settle_sale", {
    p_restaurant: actor.restaurantId,
    p_order: order.id,
    p_method: method,
    p_actor: actor.email,
    p_status: finalStatus,
  });
  if (settleError) {
    console.error("ringing a sale failed:", settleError.message);
    await db.from("orders").delete().eq("id", order.id).eq("restaurant_id", actor.restaurantId);
    await releaseStock(actor.restaurantId, reservation.reservationId);
    return await apiError("apiErr.orderCreate", 500);
  }

  if (restaurant.low_stock_alerts_enabled) {
    await raiseStockNotifications(actor.restaurantId, reservation.low);
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
    receipt,
    receiptHtml,
    // So the screen can stop telling a cashier to call somebody who is already
    // walking away with their drink.
    handedOver: handedOverAtOnce,
  });
}
